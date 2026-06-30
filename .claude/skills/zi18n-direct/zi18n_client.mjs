#!/usr/bin/env node
/**
 * zi18n_client — call the ABAP `zi18n_service` translation API directly, WITHOUT MCP.
 *
 * Self-contained (Node 18+, global fetch, zero deps). It mirrors the wire logic of
 * `@lisa/core` (packages/core/src/wire.ts) and the BTP per-user token retrieval of
 * `@arc-mcp/xsuaa-auth` (dist/btp/destination.js) so an AI agent can drive translation
 * reads/writes with a single command, getting the same conveniences the MCP gives:
 *   - envelope unwrap + error mapping (CLOUD_UNSUPPORTED, etc.)
 *   - virtual `cds_entity` fan-out (data_definition + metadata_extension) on read AND write
 *   - positional `name[n]` <-> (attribute, position) normalization
 *   - per-user auth via the BTP Destination Service (SAMLAssertion / OAuth2* Bearer), or
 *     Basic / technical for on-prem & local.
 *
 * Usage:
 *   node zi18n_client.mjs <action> [bodyJSON]
 *   node zi18n_client.mjs auth-debug
 *
 *   action  = list_languages | capabilities | list_texts | set_translation
 *   bodyJSON= the request body as a JSON string (read from stdin if omitted)
 *             target_type may be "cds_entity" — the client fans it out for you.
 *
 * Auth / connection is configured by env vars (see resolveConnection / SKILL.md):
 *   DIRECT (on-prem / local / any reachable host):
 *     ZI18N_BASE_URL      e.g. https://host:443  (presence selects direct mode)
 *     ZI18N_USER / ZI18N_PASS    -> HTTP Basic
 *     ZI18N_BEARER               -> Authorization: Bearer <token>   (wins over Basic)
 *     ZI18N_SAP_CLIENT           -> sap-client query param (optional)
 *   BTP (Destination Service; run inside CF so VCAP_SERVICES is present):
 *     VCAP_SERVICES              the bound services JSON (auto on CF)
 *     ZI18N_DESTINATION          the destination NAME to resolve
 *     ZI18N_USER_JWT             a user XSUAA access token -> per-user (X-User-Token);
 *                                omit for the technical (no-JWT) resolution
 *   Common:
 *     ZI18N_SERVICE_PATH         defaults to /sap/bc/http/sap/zi18n_service
 *
 * Exit code 0 on success (prints the action's `data` as JSON to stdout), 1 on error.
 */

const SERVICE_PATH = (process.env.ZI18N_SERVICE_PATH || '/sap/bc/http/sap/zi18n_service').replace(/\/$/, '');
const CDS_ENTITY = 'cds_entity';
const CDS_OWNERS = ['data_definition', 'metadata_extension'];
const POSITION_SUFFIX = /\[(\d+)\]$/;

// ─── helpers (mirror @lisa/core wire.ts) ──────────────────────────────────────

function compact(body) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

function normalizeListTextEntry(e) {
  const populated = typeof e.populated === 'boolean' ? e.populated : e.value !== '' && e.value != null;
  const m = POSITION_SUFFIX.exec(e.attribute || '');
  return m ? { ...e, attribute: e.attribute.slice(0, m.index), position: m[1], populated } : { ...e, populated };
}

function normalizeSetTextEntry(e) {
  const { owner: _owner, ...rest } = e;
  const m = POSITION_SUFFIX.exec(rest.attribute || '');
  return m ? { ...rest, attribute: rest.attribute.slice(0, m.index), position: rest.position ?? m[1] } : rest;
}

// ─── connection resolution ────────────────────────────────────────────────────

async function fetchClientCredentialsToken(tokenUrl, clientId, clientSecret) {
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!resp.ok) throw new Error(`Destination Service token HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return (await resp.json()).access_token;
}

/** Resolve a BTP destination (per-user when userJwt is given) via the Destination Service. */
export async function resolveBtpDestination(destinationName, userJwt) {
  const vcap = JSON.parse(process.env.VCAP_SERVICES);
  const c = vcap.destination?.[0]?.credentials;
  if (!c) throw new Error('VCAP_SERVICES has no `destination` binding');
  const destUri = (c.uri || c.url).replace(/\/$/, '');
  const tokenUrl = c.token_service_url || `${c.url.replace(/\/$/, '')}/oauth/token`;
  const svcToken = await fetchClientCredentialsToken(tokenUrl, c.clientid, c.clientsecret);

  const headers = { Authorization: `Bearer ${svcToken}` };
  if (userJwt) headers['X-User-Token'] = userJwt; // <- the principal-propagation trigger
  const resp = await fetch(`${destUri}/destination-configuration/v1/destinations/${encodeURIComponent(destinationName)}`, {
    headers,
  });
  if (!resp.ok) throw new Error(`Destination Service HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const dest = data.destinationConfiguration || {};
  const tokens = Array.isArray(data.authTokens) ? data.authTokens : [];

  for (const t of tokens) {
    if (t.error) throw new Error(`Destination auth token error for '${destinationName}': ${t.error}`);
  }
  const out = { baseUrl: (dest.URL || '').replace(/\/$/, ''), headers: { Accept: 'application/json' }, sapClient: dest['sap-client'] };
  // First usable token's Authorization header value (SAML2.0 … or Bearer …). Covers SAMLAssertion,
  // OAuth2UserTokenExchange and OAuth2SAMLBearerAssertion uniformly.
  const usable = tokens.find((t) => !t.error && t.http_header?.value);
  if (usable) {
    out.headers.Authorization = usable.http_header.value;
    if (dest.Authentication === 'SAMLAssertion') out.headers['x-sap-security-session'] = 'create';
  } else if (dest.User && dest.Password) {
    out.headers.Authorization = `Basic ${Buffer.from(`${dest.User}:${dest.Password}`).toString('base64')}`;
  }
  if (dest.ProxyType === 'OnPremise') {
    throw new Error('Destination is ProxyType=OnPremise (Cloud Connector). This client only does direct/Internet calls — use the MCP server for on-prem principal propagation.');
  }
  return out;
}

async function resolveConnection() {
  const baseUrl = process.env.ZI18N_BASE_URL;
  if (baseUrl) {
    const headers = { Accept: 'application/json' };
    if (process.env.ZI18N_BEARER) headers.Authorization = `Bearer ${process.env.ZI18N_BEARER}`;
    else if (process.env.ZI18N_USER && process.env.ZI18N_PASS)
      headers.Authorization = `Basic ${Buffer.from(`${process.env.ZI18N_USER}:${process.env.ZI18N_PASS}`).toString('base64')}`;
    return { baseUrl: baseUrl.replace(/\/$/, ''), headers, sapClient: process.env.ZI18N_SAP_CLIENT };
  }
  if (process.env.VCAP_SERVICES && process.env.ZI18N_DESTINATION) {
    const conn = await resolveBtpDestination(process.env.ZI18N_DESTINATION, process.env.ZI18N_USER_JWT);
    if (process.env.ZI18N_SAP_CLIENT) conn.sapClient = process.env.ZI18N_SAP_CLIENT;
    return conn;
  }
  throw new Error('No connection configured. Set ZI18N_BASE_URL (direct) or VCAP_SERVICES + ZI18N_DESTINATION (BTP). See SKILL.md.');
}

// ─── action call (mirror @lisa/core callAction) ───────────────────────────────

async function callAction(conn, action, body) {
  const url = new URL(`${conn.baseUrl}${SERVICE_PATH}/${action}`);
  if (conn.sapClient) url.searchParams.set('sap-client', conn.sapClient);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...conn.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(compact(body)),
  });
  const text = await resp.text();
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error(`SAP HTTP ${resp.status}: non-JSON response: ${text.slice(0, 300)}`);
  }
  if (!env.success || resp.status < 200 || resp.status >= 300) {
    const code = env.error?.code ?? `HTTP_${resp.status}`;
    const message = env.error?.message ?? text.slice(0, 300);
    if (code === 'CLOUD_UNSUPPORTED')
      throw new Error(`Not available on the ABAP Cloud (public cloud / BTP ABAP Environment) stack — ${message}`);
    throw new Error(`SAP i18n error [${code}]: ${message}`);
  }
  if (env.data === undefined) throw new Error('SAP i18n response had success=true but no data');
  return env.data;
}

// ─── high-level operations (mirror I18nCore) ──────────────────────────────────

async function listTexts(conn, body) {
  const data = await callAction(conn, 'list_texts', body);
  return { ...data, texts: (data.texts ?? []).map(normalizeListTextEntry) };
}

async function getCdsEntityTexts(conn, body) {
  const texts = [];
  const errors = [];
  let language = body.language ?? '';
  for (const owner of CDS_OWNERS) {
    try {
      const part = await listTexts(conn, { target_type: owner, object_name: body.object_name, language: body.language });
      if (part.language) language = part.language;
      for (const t of part.texts) texts.push(t.owner ? t : { ...t, owner });
    } catch (e) {
      errors.push({ target_type: owner, owner, error: e.message });
    }
  }
  if (texts.length === 0 && errors.length > 0)
    throw new Error(`cds_entity read failed: ${errors.map((e) => `${e.target_type}: ${e.error}`).join('; ')}`);
  const result = { target_type: CDS_ENTITY, object_name: body.object_name, language, texts };
  return errors.length > 0 ? { ...result, errors } : result;
}

async function setTranslation(conn, body) {
  const texts = (body.texts || []).map(normalizeSetTextEntry);
  return callAction(conn, 'set_translation', { ...body, texts });
}

async function setCdsEntityTexts(conn, body) {
  const buckets = new Map();
  for (const e of body.texts || []) {
    if (e.owner !== 'data_definition' && e.owner !== 'metadata_extension')
      throw new Error("cds_entity set requires an 'owner' on every text row (data_definition | metadata_extension)");
    let bucket = buckets.get(e.owner);
    if (!bucket) buckets.set(e.owner, (bucket = []));
    bucket.push(e);
  }
  const results = [];
  for (const owner of CDS_OWNERS) {
    const bucket = buckets.get(owner);
    if (!bucket || bucket.length === 0) continue;
    try {
      const r = await setTranslation(conn, {
        target_type: owner,
        object_name: body.object_name,
        language: body.language,
        transport: body.transport,
        texts: bucket,
      });
      results.push({ target_type: owner, owner, written: bucket.length, success: r.success !== false });
    } catch (e) {
      results.push({ target_type: owner, owner, written: 0, success: false, error: e.message });
    }
  }
  return { success: results.every((r) => r.success), results };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (s += c));
    process.stdin.on('end', () => resolve(s));
  });
}

async function main() {
  const action = process.argv[2];
  if (!action || action === '--help' || action === '-h') {
    console.log('usage: node zi18n_client.mjs <list_languages|capabilities|list_texts|set_translation|auth-debug> [bodyJSON]');
    process.exit(action ? 0 : 1);
  }

  if (action === 'auth-debug') {
    const conn = await resolveConnection();
    console.log(JSON.stringify({
      baseUrl: conn.baseUrl,
      sapClient: conn.sapClient ?? null,
      authScheme: conn.headers.Authorization?.split(' ')[0] ?? 'none',
      samlSession: conn.headers['x-sap-security-session'] ?? null,
    }, null, 2));
    return;
  }

  // Body from argv[3]; pass "-" to read it from stdin (for large/piped bodies). Defaults to {}.
  const arg = process.argv[3];
  const raw = arg === '-' ? await readStdin() : (arg ?? '{}');
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    throw new Error(`bodyJSON is not valid JSON: ${e.message}`);
  }

  const conn = await resolveConnection();
  let data;
  switch (action) {
    case 'list_languages':
      data = await callAction(conn, 'list_languages', {});
      break;
    case 'capabilities':
      data = await callAction(conn, 'capabilities', {});
      break;
    case 'list_texts':
      data = body.target_type === CDS_ENTITY ? await getCdsEntityTexts(conn, body) : await listTexts(conn, body);
      break;
    case 'set_translation':
      data = body.target_type === CDS_ENTITY ? await setCdsEntityTexts(conn, body) : await setTranslation(conn, body);
      break;
    default:
      throw new Error(`unknown action: ${action}`);
  }
  console.log(JSON.stringify(data, null, 2));
}

// Run as a CLI only when invoked directly (not when imported for testing).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  });
}
