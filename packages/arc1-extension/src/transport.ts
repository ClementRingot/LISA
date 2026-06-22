import type { I18nHttpResponse, I18nTransport, WireAction } from '@lisa/core';
import type { SafeHttpClient } from 'arc-1/public';

/**
 * The ARC-1 side of the `I18nTransport` seam: perform the POST to LISA's custom ICF
 * service through `ctx.http`, ARC-1's authenticated SAP client (per-user principal propagation,
 * CSRF fetched + attached automatically).
 *
 * Path: `${servicePath}/${action}`, default servicePath `/sap/bc/http/sap/zi18n_service`
 * (override with SAP_I18N_SERVICE_PATH). The path is NON-ADT, so it rides ARC-1's gated raw-write
 * surface — which is why each tool declares `scope:'write'` and the deployment needs
 * `SAP_ALLOW_PLUGIN_RAW_WRITES` (see docs_page/arc1-extension-deployment.md).
 */

const DEFAULT_SERVICE_PATH = '/sap/bc/http/sap/zi18n_service';

function servicePath(): string {
  const p = process.env.SAP_I18N_SERVICE_PATH?.trim();
  return (p && p.length > 0 ? p : DEFAULT_SERVICE_PATH).replace(/\/$/, '');
}

export function ctxHttpTransport(http: SafeHttpClient): I18nTransport {
  const base = servicePath();
  return {
    async post(action: WireAction, jsonBody: string): Promise<I18nHttpResponse> {
      const res = await http.post(`${base}/${action}`, jsonBody, 'application/json', {
        Accept: 'application/json',
      });
      return { status: res.statusCode, body: res.body };
    },
  };
}
