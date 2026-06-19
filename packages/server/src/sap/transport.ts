/**
 * BTP / principal-propagation implementation of the `@lisa/core` `I18nTransport` seam.
 *
 * The service must be registered as an ABAP HTTP Service on the SAP system.
 * By default the path is /sap/bc/http/sap/zi18n_service but it is overridable
 * via the SAP_I18N_SERVICE_PATH env var.
 */

import {
  type BTPConfig,
  type BTPProxyConfig,
  createConnectivityProxy,
  lookupDestination,
  lookupDestinationWithUserToken,
  parseVCAPServices,
} from '@arc-mcp/xsuaa-auth/btp';
import type { I18nHttpResponse, I18nTransport } from '@lisa/core';
import { Client, type Dispatcher, fetch as undiciFetch } from 'undici';
import { toPackageLogger } from '../server/logger.js';
import type { Config } from '../server/types.js';

interface ResolvedConnection {
  baseUrl: string;
  headers: Record<string, string>;
  // Cloud Connector proxy — set only for OnPremise BTP destinations. When present, requests are
  // sent through it using standard HTTP forward-proxy (NOT CONNECT tunneling), the only protocol
  // the BTP connectivity proxy supports. Mirrors ARC-1's AdtHttpClient.doProxyRequest().
  proxy: BTPProxyConfig | null;
  // sap-client query param. From the destination on BTP, or SAP_CLIENT for local dev.
  sapClient?: string;
}

// ─── Cached BTP service bindings ──────────────────────────────────────────────
// Parsed once: VCAP_SERVICES is immutable for the app lifetime, and the connectivity proxy
// caches/refreshes its own token internally, so a single proxy instance must be reused.

let btpConfigCache: BTPConfig | null | undefined;
let proxyCache: BTPProxyConfig | null | undefined;

// Route the package's BTP / principal-propagation diagnostics into LISA's logger
// (the package's `./btp` helpers default to a silent no-op otherwise).
const btpLogger = toPackageLogger();

function getBtpConfig(): BTPConfig | null {
  if (btpConfigCache === undefined) btpConfigCache = parseVCAPServices(undefined, btpLogger);
  return btpConfigCache;
}

function getProxy(btpConfig: BTPConfig, proxyType: string, locationId?: string): BTPProxyConfig | null {
  if (proxyType !== 'OnPremise') return null;
  if (proxyCache === undefined) proxyCache = createConnectivityProxy(btpConfig, locationId, btpLogger);
  return proxyCache;
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function resolveConnection(config: Config, userJwt?: string): Promise<ResolvedConnection> {
  if (config.btpDestination) {
    const btpConfig = getBtpConfig();
    if (!btpConfig) {
      throw new Error('SAP_BTP_DESTINATION is set but VCAP_SERVICES is unavailable. Running on BTP CF?');
    }

    const headers: Record<string, string> = { Accept: 'application/json' };

    // Principal propagation: when the user JWT is available AND a PP destination is configured,
    // resolve the destination per-user so BTP/Cloud Connector authenticate as the backend user.
    // Falls back to the BasicAuth (technical) destination otherwise — e.g. system-level calls.
    if (userJwt && config.btpPpDestination) {
      const { destination, authTokens } = await lookupDestinationWithUserToken(
        btpConfig,
        config.btpPpDestination,
        userJwt,
        btpLogger,
      );
      if (authTokens.sapConnectivityAuth) {
        headers['SAP-Connectivity-Authentication'] = authTokens.sapConnectivityAuth;
      } else if (authTokens.bearerToken) {
        headers.Authorization = `Bearer ${authTokens.bearerToken}`;
      } else if (destination.User && destination.Password) {
        headers.Authorization = basicAuth(destination.User, destination.Password);
      }
      return {
        baseUrl: destination.URL.replace(/\/$/, ''),
        headers,
        proxy: getProxy(btpConfig, destination.ProxyType, destination.CloudConnectorLocationId),
        sapClient: destination['sap-client'],
      };
    }

    const dest = await lookupDestination(btpConfig, config.btpDestination, btpLogger);
    if (dest.User && dest.Password) {
      headers.Authorization = basicAuth(dest.User, dest.Password);
    }
    return {
      baseUrl: dest.URL.replace(/\/$/, ''),
      headers,
      proxy: getProxy(btpConfig, dest.ProxyType, dest.CloudConnectorLocationId),
      sapClient: dest['sap-client'],
    };
  }

  // Local dev: direct connection (no principal propagation, no Cloud Connector proxy)
  if (!config.sapUrl) throw new Error('SAP_URL is required for local development');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.sapUsername && config.sapPassword) {
    headers.Authorization = basicAuth(config.sapUsername, config.sapPassword);
  }
  return { baseUrl: config.sapUrl.replace(/\/$/, ''), headers, proxy: null, sapClient: config.sapClient };
}

function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Send a request through the BTP connectivity proxy using standard HTTP forward-proxy
 * (RFC 7230): the full target URL is sent as the request path, with Proxy-Authorization
 * (connectivity token) and, for principal propagation, SAP-Connectivity-Authentication.
 *
 * The BTP connectivity proxy only supports standard proxying for HTTP targets — it returns
 * 405 on CONNECT tunneling, so undici's ProxyAgent cannot be used. Ported from ARC-1's
 * AdtHttpClient.doProxyRequest().
 */
async function doProxyRequest(
  proxy: BTPProxyConfig,
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<I18nHttpResponse> {
  const proxyOrigin = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  const proxyToken = await proxy.getProxyToken();

  const targetUrl = new URL(url);
  const hostHeader = targetUrl.port ? `${targetUrl.hostname}:${targetUrl.port}` : targetUrl.hostname;

  const proxyHeaders: Record<string, string> = {
    ...headers,
    Host: hostHeader,
    'Proxy-Authorization': `Bearer ${proxyToken}`,
  };
  // Required when several Cloud Connectors share the subaccount with different Location IDs.
  if (proxy.locationId) {
    proxyHeaders['SAP-Connectivity-SCC-Location_ID'] = proxy.locationId;
  }

  const client = new Client(proxyOrigin);
  try {
    const resp = await client.request({
      method: method as Dispatcher.HttpMethod,
      path: url, // full URL as path — standard HTTP forward-proxy protocol
      headers: proxyHeaders,
      body: body ?? undefined,
      signal: AbortSignal.timeout(120_000),
    });
    return { status: resp.statusCode, body: await resp.body.text() };
  } finally {
    await client.close();
  }
}

async function sapRequest(
  conn: ResolvedConnection,
  method: string,
  url: string,
  body?: string,
): Promise<I18nHttpResponse> {
  const headers = { ...conn.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (conn.proxy) {
    return doProxyRequest(conn.proxy, url, method, headers, body);
  }

  const resp = await undiciFetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(120_000),
  });
  return { status: resp.status, body: await resp.text() };
}

/** Builds the `I18nTransport` the `@lisa/core` `I18nCore` posts wire actions through. */
export function btpTransport(config: Config, userJwt?: string): I18nTransport {
  return {
    async post(action, jsonBody) {
      const conn = await resolveConnection(config, userJwt);
      // sap-client stays a query param — it is consumed by the ICF framework, not the handler.
      const url = buildUrl(conn.baseUrl, `${config.i18nServicePath}/${action}`, {
        ...(conn.sapClient ? { 'sap-client': conn.sapClient } : {}),
      });
      return sapRequest(conn, 'POST', url, jsonBody);
    },
  };
}
