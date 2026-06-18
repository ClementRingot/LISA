/**
 * HTTP client for zi18n_service (ABAP handler class ZCL_I18N_SERVICE).
 *
 * The service must be registered in SICF (transaction) on the SAP system.
 * By default the path is /sap/bc/http/sap/zi18n_service but it is overridable
 * via the SAP_I18N_SERVICE_PATH env var.
 *
 * Wire contract — mirrors ZCL_I18N_SERVICE exactly:
 *   - The ACTION is the last segment of the URL path (handler reads `~path_info`),
 *     lowercase. The wrapper drives list_languages | list_texts | set_translation, plus a
 *     `capabilities` probe (cached) used to reject stack-unsupported (action, target_type) calls
 *     up-front. (The handler also exposes get_translation and compare_translations, but the MCP
 *     surface no longer uses them — list_texts is the whole-object reader and the client diffs locally.)
 *   - ALL parameters are sent in the JSON request BODY (handler reads `request->get_text()`
 *     and string-matches "name":"value"). We therefore POST every action with a JSON body.
 *   - Object kinds are the XCO semantic `target_type` literals (data_element, domain, …).
 *   - Every response is wrapped: { "success": true, "data": {…} } on success, or
 *     { "success": false, "error": { "code", "message" } } with HTTP 400 on failure.
 *
 *   POST {path}/list_languages   body: {}
 *   POST {path}/list_texts       body: { target_type, object_name, language?, text_pool_owner_type? }
 *   POST {path}/set_translation  body: { target_type, object_name, language, transport,
 *                                        texts: [{ attribute, value, field_name?, position? }, …],
 *                                        …selectors }
 */

import {
  type BTPConfig,
  type BTPProxyConfig,
  createConnectivityProxy,
  lookupDestination,
  lookupDestinationWithUserToken,
  parseVCAPServices,
} from '@arc-mcp/xsuaa-auth/btp';
import { Client, type Dispatcher, fetch as undiciFetch } from 'undici';
import { toPackageLogger } from '../server/logger.js';
import type { Config } from '../server/types.js';

// ─── Response types (match ZCL_I18N_SERVICE JSON exactly) ──────────────────────

/** Envelope every handler wraps its payload in (build_success / build_error). */
interface SapEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface SapLanguage {
  sap_code: string; // SAP language key (SPRAS, 1 char)
  iso_code: string; // ISO 639-1 code
  name: string; // language name
}

/** A single XCO text attribute/value pair (append_text_entry). */
export interface TextEntry {
  attribute: string;
  value: string;
}

/**
 * A text entry for set_translation. Beyond { attribute, value } it may carry its own
 * `field_name`/`position` selectors: when present they override the top-level selectors for
 * THIS entry only, so one set_translation call can address several CDS fields of the same
 * object (the ABAP groups entries by field and writes each within a single change scenario,
 * locking the object once). Both are sent as strings to match the handler's parser.
 */
export interface SetTextEntry extends TextEntry {
  field_name?: string;
  position?: string;
}

/**
 * list_texts entries carry extra level/field context (build_text_json_entry).
 *
 * `populated` is the canonical "this text is filled in the requested language" signal the ABAP
 * emits as `xsdbool( iv_value IS NOT INITIAL )` — false means "to translate". `position` is
 * decomposed by the wrapper from the ABAP `attribute` when it is encoded `name[n]` (e.g.
 * `ui_facet_label[1]` → attribute `ui_facet_label`, position `"1"`), so the
 * (field_name, position, attribute) triple round-trips straight into set_translation.
 */
export interface ListTextEntry extends TextEntry {
  level: string; // 'entity' | 'field' | 'fixed_value' | 'message' | 'text_symbol'
  field_name: string; // empty for entity-level texts
  position?: string; // 1-based position for repeatable annotations; absent when not positional
  populated: boolean; // true when the value is non-empty in the requested language
}

export interface ListTextsResult {
  target_type: string;
  object_name: string;
  language: string; // effective language the ABAP read in (original language when none was sent)
  texts: ListTextEntry[];
}

export interface SetTranslationResult {
  target_type: string;
  object_name: string;
  language: string;
  transport: string;
  success: boolean;
}

/** Optional selectors the handler reads to disambiguate sub-objects within a target. */
export interface I18nSelectors {
  field_name?: string;
  fixed_value?: string;
  message_number?: string;
  text_symbol_id?: string;
  text_pool_owner_type?: string;
  subobject_name?: string;
  position?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

interface RawResponse {
  status: number;
  body: string;
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
): Promise<RawResponse> {
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

async function sapRequest(conn: ResolvedConnection, method: string, url: string, body?: string): Promise<RawResponse> {
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

/** Drop undefined/empty fields so we only send what the handler should parse. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

/**
 * POST an action to {servicePath}/{action} with a JSON body and unwrap the
 * { success, data, error } envelope. The ABAP action is the last path segment,
 * so it must be lowercase (list_languages, get_translation, …).
 */
async function callAction<T>(
  conn: ResolvedConnection,
  servicePath: string,
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  // sap-client stays a query param — it is consumed by the ICF framework, not the handler.
  const url = buildUrl(conn.baseUrl, `${servicePath}/${action}`, {
    ...(conn.sapClient ? { 'sap-client': conn.sapClient } : {}),
  });
  const { status, body: respBody } = await sapRequest(conn, 'POST', url, JSON.stringify(compact(body)));

  let envelope: SapEnvelope<T>;
  try {
    envelope = JSON.parse(respBody) as SapEnvelope<T>;
  } catch {
    throw new Error(`SAP HTTP ${status}: non-JSON response: ${respBody.slice(0, 300)}`);
  }

  if (!envelope.success || status < 200 || status >= 300) {
    const code = envelope.error?.code ?? `HTTP_${status}`;
    const message = envelope.error?.message ?? respBody.slice(0, 300);
    // The cloud handler's backstop for operations the released APIs cannot serve.
    // Surface it as a clear stack-limitation message rather than a raw error code.
    if (code === 'CLOUD_UNSUPPORTED') {
      throw new Error(`Not available on the SAP ABAP Cloud (public cloud / BTP ABAP Environment) stack — ${message}`);
    }
    throw new Error(`SAP i18n error [${code}]: ${message}`);
  }
  if (envelope.data === undefined) {
    throw new Error('SAP i18n response had success=true but no data');
  }
  return envelope.data;
}

// ─── list_texts entry normalization ───────────────────────────────────────────

/** Trailing 1-based position encoded by the ABAP as `name[n]` (e.g. ui_facet_label[1]). */
const POSITION_SUFFIX = /\[(\d+)\]$/;

/**
 * Normalize one raw list_texts entry:
 *   - decompose `attribute` "name[n]" → base attribute + `position` "n" so the
 *     (field_name, position, attribute) key feeds set_translation unchanged;
 *   - guarantee `populated` is present — older ABAP builds omit it, so fall back to
 *     "value is non-empty" without inventing anything the server didn't say.
 */
export function normalizeListTextEntry(entry: ListTextEntry): ListTextEntry {
  const populated = typeof entry.populated === 'boolean' ? entry.populated : entry.value !== '' && entry.value != null;

  const match = POSITION_SUFFIX.exec(entry.attribute);
  if (match) {
    return {
      ...entry,
      attribute: entry.attribute.slice(0, match.index),
      position: match[1],
      populated,
    };
  }
  return { ...entry, populated };
}

// ─── Backend capabilities (proactive object-type guard) ────────────────────────
// The ABAP `capabilities` action returns an ALLOW-LIST: the object types this stack
// can translate, per action (e.g. { list_texts: [...], set_translation: [...] }).
// Public cloud / BTP ABAP Environment and on-premise / private cloud support DIFFERENT
// object types, and the supported set can also vary by SYSTEM RELEASE (a future deployment
// might ship per-release handler classes, e.g. zcl_i18n_service_2022 / _2025). Because each
// class DECLARES its own list, LISA follows whatever the bound handler reports with no code
// change. The list is editable in the handler class (remove a type to disable it). LISA
// fetches it once, caches it, and rejects a target_type not on the list up-front instead of
// round-tripping to SAP only to hit the CLOUD_UNSUPPORTED backstop. Older handlers without
// the action degrade gracefully to permissive (the backstop still fires).

/** Supported object types per wire action, as declared by the handler's allow-list. */
export type Capabilities = Record<string, string[]>;

/**
 * Pure check: does the backend allow this target_type for this action? Permissive (true)
 * when the backend declares nothing for the action (older handler / unknown) — the ABAP
 * CLOUD_UNSUPPORTED backstop still catches real gaps in that case.
 */
export function isTargetTypeSupported(
  capabilities: Capabilities | null | undefined,
  action: string,
  targetType: string,
): boolean {
  const allowed = capabilities?.[action];
  if (!allowed) return true;
  return allowed.includes(targetType);
}

/** Assistant-facing message for an object type the target system does not support. */
export function unsupportedTargetMessage(action: string, targetType: string): string {
  return (
    `target_type '${targetType}' is not available for '${action}' on this SAP system ` +
    '(not in its declared capabilities). Public cloud / BTP ABAP Environment and ' +
    'on-premise / private cloud support different object types.'
  );
}

// Probed once per process (the backend is fixed for the app lifetime).
// undefined = not probed; null = backend exposes no `capabilities` action (permissive).
let capabilitiesCache: Capabilities | null | undefined;

async function loadCapabilities(conn: ResolvedConnection, servicePath: string): Promise<Capabilities | null> {
  if (capabilitiesCache !== undefined) return capabilitiesCache;
  try {
    capabilitiesCache = await callAction<Capabilities>(conn, servicePath, 'capabilities', {});
  } catch (e) {
    // Handler without the `capabilities` action (older build) → permissive: rely on
    // the ABAP CLOUD_UNSUPPORTED backstop. Other (transient) errors stay permissive
    // for this call without poisoning the cache so a later call can retry.
    const msg = e instanceof Error ? e.message : '';
    if (/\[(UNKNOWN_ACTION|HTTP_404)\]/.test(msg)) capabilitiesCache = null;
    return capabilitiesCache ?? null;
  }
  return capabilitiesCache;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class I18nClient {
  constructor(
    private readonly config: Config,
    private readonly userJwt?: string,
  ) {}

  private get path(): string {
    return this.config.i18nServicePath;
  }

  /** Reject a target_type the backend's allow-list does not include for this action. */
  private async assertActionSupported(conn: ResolvedConnection, action: string, targetType: string): Promise<void> {
    const caps = await loadCapabilities(conn, this.path);
    if (!isTargetTypeSupported(caps, action, targetType)) {
      throw new Error(unsupportedTargetMessage(action, targetType));
    }
  }

  async listLanguages(): Promise<SapLanguage[]> {
    const conn = await resolveConnection(this.config, this.userJwt);
    const data = await callAction<{ languages: SapLanguage[] }>(conn, this.path, 'list_languages', {});
    return data.languages;
  }

  /**
   * Whole-object reader (list_texts). `language` is optional: when omitted, nothing is sent and
   * the ABAP reads in the object's original language, echoing the effective `language` back.
   * Every entry is normalized (decomposed position + guaranteed `populated`).
   */
  async getTexts(params: {
    target_type: string;
    object_name: string;
    language?: string;
    text_pool_owner_type?: string;
  }): Promise<ListTextsResult> {
    const conn = await resolveConnection(this.config, this.userJwt);
    await this.assertActionSupported(conn, 'list_texts', params.target_type);
    const data = await callAction<ListTextsResult>(conn, this.path, 'list_texts', { ...params });
    return { ...data, texts: (data.texts ?? []).map(normalizeListTextEntry) };
  }

  async setTranslation(
    params: {
      target_type: string;
      object_name: string;
      language: string;
      transport: string;
      texts: SetTextEntry[];
    } & I18nSelectors,
  ): Promise<SetTranslationResult> {
    const conn = await resolveConnection(this.config, this.userJwt);
    await this.assertActionSupported(conn, 'set_translation', params.target_type);
    return callAction<SetTranslationResult>(conn, this.path, 'set_translation', { ...params });
  }
}
