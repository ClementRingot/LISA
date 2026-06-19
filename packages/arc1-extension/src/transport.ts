import type { I18nHttpResponse, I18nTransport, WireAction } from '@lisa/core';
import type { AdtResponse, SafeHttpClient } from 'arc-1/public';

/**
 * The ARC-1 side of the `I18nTransport` seam: perform the POST to LISA's custom ICF
 * service through `ctx.http`, ARC-1's authenticated SAP client (per-user principal propagation,
 * CSRF fetched + attached automatically).
 *
 * Path: `${servicePath}/${action}`, default servicePath `/sap/bc/http/sap/zi18n_service`
 * (override with SAP_I18N_SERVICE_PATH). NON-ADT — so it rides the raw-write surface added in
 * arc-mcp/arc-1#474, which is why it needs `ctx.http.post` (gated; see each tool's policy).
 *
 * arc-mcp/arc-1#474 is merged on arc-1's `main` branch but not yet in the latest published npm
 * release (`arc-1@0.9.19` ships a GET/HEAD-only `SafeHttpClient`), so the installed type doesn't
 * declare `post`/`put`/`delete` yet. The cast below is the single boundary point for that gap —
 * drop it once arc-1 publishes a release containing #474.
 */
// Mirrors the exact `post` signature arc-mcp/arc-1#474 adds to `SafeHttpClient`
// (Promise<AdtResponse>), so this whole type — and the cast below — collapses to a
// no-op the moment that signature ships in `SafeHttpClient` itself.
type GatedHttpClient = SafeHttpClient & {
  post(path: string, body?: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
};

const DEFAULT_SERVICE_PATH = '/sap/bc/http/sap/zi18n_service';

function servicePath(): string {
  const p = process.env.SAP_I18N_SERVICE_PATH?.trim();
  return (p && p.length > 0 ? p : DEFAULT_SERVICE_PATH).replace(/\/$/, '');
}

export function ctxHttpTransport(http: SafeHttpClient): I18nTransport {
  const base = servicePath();
  const gatedHttp = http as unknown as GatedHttpClient;
  return {
    async post(action: WireAction, jsonBody: string): Promise<I18nHttpResponse> {
      const res = await gatedHttp.post(`${base}/${action}`, jsonBody, 'application/json', {
        Accept: 'application/json',
      });
      return { status: res.statusCode, body: res.body };
    },
  };
}
