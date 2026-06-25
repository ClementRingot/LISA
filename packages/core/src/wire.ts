/**
 * Transport-agnostic wire contract for zi18n_service (ABAP handler class ZCL_I18N_SERVICE).
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
 *
 * This module knows nothing about HOW a request reaches the backend (BTP destinations,
 * principal propagation, Cloud Connector, plain fetch, or an already-authenticated ARC-1
 * `ctx.http`) — that is the `I18nTransport` seam each distribution implements.
 */

// ─── Transport seam ─────────────────────────────────────────────────────────

export interface I18nHttpResponse {
  status: number;
  body: string;
}

export type WireAction = 'list_languages' | 'list_texts' | 'set_translation' | 'capabilities';

/**
 * The only thing a distribution (standalone MCP server, ARC-1 extension, …) must implement.
 * `jsonBody` is already the final compacted+serialized JSON string — transports just POST it to
 * `{servicePath}/{action}` (sap-client as a query param) and return the raw status + body. All
 * wire-contract logic (compaction, serialization, envelope unwrap) stays in core.
 */
export interface I18nTransport {
  post(action: WireAction, jsonBody: string): Promise<I18nHttpResponse>;
}

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
 *
 * `owner` is the physical CDS object the slot belongs to ("data_definition" for a view-owned
 * slot, "metadata_extension" for a DDLX-owned slot). It is the round-trip companion of the
 * `owner` the reader stamps on each CDS row: `setTextsByOwner` groups entries by it and routes
 * each group to the matching backend target_type, so each physical object (DDLS vs DDLX) is
 * locked/transported exactly once. It is a LISA routing key only — it is NOT sent on the wire.
 */
export interface SetTextEntry extends TextEntry {
  field_name?: string;
  position?: string;
  owner?: string;
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
  // For CDS rows the backend stamps the physical object that owns the slot: "data_definition"
  // (the view/DDLS itself) or "metadata_extension" (its DDLX). Absent for non-CDS target_types.
  // READ this from the row — never derive it from which backend call produced the row. It feeds
  // set_translation routing so a merged CDS entity round-trips each slot to the right object.
  owner?: string;
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

/** Drop undefined/empty fields so we only send what the handler should parse. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

/**
 * POST an action to {servicePath}/{action} via the injected transport and unwrap the
 * { success, data, error } envelope. The ABAP action is the last path segment,
 * so it must be lowercase (list_languages, get_translation, …).
 */
async function callAction<T>(transport: I18nTransport, action: WireAction, body: Record<string, unknown>): Promise<T> {
  const { status, body: respBody } = await transport.post(action, JSON.stringify(compact(body)));

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

// ─── Merged CDS entity surface ─────────────────────────────────────────────────
// `data_definition` (the CDS view / DDLS) and `metadata_extension` (its DDLX) are two
// PHYSICAL objects but one logical translation surface: a view often defines its UI labels
// inline, a projection delegates them to a DDLX, and either may hold any given slot. LISA
// exposes that surface under the synthetic target_type `cds_entity`: get fans out to BOTH
// backend reads and concatenates, and the backend stamps every row with the `owner` that
// tells set which physical object to write back to. `cds_entity` is a LISA concept — it is
// never sent on the wire; only `data_definition` / `metadata_extension` reach the backend.

/** Synthetic target_type for the merged CDS entity surface (view + its DDLX). */
export const CDS_ENTITY_TARGET = 'cds_entity';

/** The physical CDS objects a `cds_entity` fans out to, in output order (view first, DDLX second). */
export const CDS_ENTITY_OWNERS = ['data_definition', 'metadata_extension'] as const;

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

/**
 * Prepare one set_translation entry for the wire. The backend reads `attribute` and `position`
 * as SEPARATE fields, so a positional slot must arrive split. A round-tripped read already comes
 * decomposed (normalizeListTextEntry), but a hand-built entry may still carry the bracketed form
 * `name[n]` the reader emits — accept it and move the index into `position` (an explicit `position`
 * on the entry wins). The index is never renumbered or dropped; it just travels in its own field so
 * set writes back to the exact slot. `owner` is a LISA routing key and is stripped here so it never
 * reaches the backend parser.
 */
export function normalizeSetTextEntry(entry: SetTextEntry): SetTextEntry {
  const { owner: _owner, ...rest } = entry;
  const match = POSITION_SUFFIX.exec(rest.attribute);
  if (match) {
    return {
      ...rest,
      attribute: rest.attribute.slice(0, match.index),
      position: rest.position ?? match[1],
    };
  }
  return rest;
}

/**
 * Narrow whole-object list_texts entries by the optional `field_name` (case-insensitive) /
 * `position` selectors. `list_texts` enumerates every field/position, so both distributions
 * (standalone server + ARC-1 extension) filter client-side on top of the reader — this is the
 * one shared implementation so the two can't drift.
 */
export function narrowListTexts(
  texts: ListTextEntry[],
  selectors: { field_name?: string; position?: string },
): ListTextEntry[] {
  let out = texts;
  if (selectors.field_name) {
    const fieldName = selectors.field_name.toUpperCase();
    out = out.filter((t) => t.field_name.toUpperCase() === fieldName);
  }
  if (selectors.position) {
    out = out.filter((t) => t.position === selectors.position);
  }
  return out;
}

// ─── Backend capabilities (proactive object-type guard) ────────────────────────
// The ABAP `capabilities` action returns an ALLOW-LIST: the object types this stack
// can translate, per action (e.g. { list_texts: [...], set_translation: [...] }).
// Public cloud / BTP ABAP Environment and on-premise / private cloud support DIFFERENT
// object types, and the set can also differ by system version. Because the handler class
// DECLARES its own list, LISA follows whatever the bound handler reports with no code change.
// The list is editable in the handler class (remove a type to disable it). LISA fetches it
// once per process, caches it, and rejects a target_type not on the list up-front instead of
// round-tripping to SAP only to hit the CLOUD_UNSUPPORTED backstop. Older handlers without the
// action degrade gracefully to permissive (the backstop still fires).
//
// The cache is process-wide (module scope), not per-I18nCore-instance: the ARC-1 extension
// constructs a fresh I18nCore per tool call, so an instance-level cache would never hit.

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
  return `target_type '${targetType}' is not available for '${action}' on this SAP system (not in its declared capabilities). Public cloud / BTP ABAP Environment and on-premise / private cloud support different object types.`;
}

// Probed once per process (the backend is fixed for the app lifetime).
// undefined = not probed; null = backend exposes no `capabilities` action (permissive).
let capabilitiesCache: Capabilities | null | undefined;

async function loadCapabilities(transport: I18nTransport): Promise<Capabilities | null> {
  if (capabilitiesCache !== undefined) return capabilitiesCache;
  try {
    capabilitiesCache = await callAction<Capabilities>(transport, 'capabilities', {});
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

/** Test seam: reset the process-wide capabilities cache between unit tests. */
export function __resetCapabilitiesCache(): void {
  capabilitiesCache = undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class I18nCore {
  constructor(private readonly transport: I18nTransport) {}

  /** Reject a target_type the backend's allow-list does not include for this action. */
  private async assertActionSupported(action: WireAction, targetType: string): Promise<void> {
    const caps = await loadCapabilities(this.transport);
    if (!isTargetTypeSupported(caps, action, targetType)) {
      throw new Error(unsupportedTargetMessage(action, targetType));
    }
  }

  /**
   * The backend's per-action allow-list, so tool descriptions can advertise the object types THIS
   * system actually supports (proactive guidance, not just the reactive assertActionSupported reject).
   * Returns null when the backend declares no allow-list (older handler) OR the probe failed —
   * callers then fall back to generic wording.
   */
  async getCapabilities(): Promise<Capabilities | null> {
    try {
      return await loadCapabilities(this.transport);
    } catch {
      return null;
    }
  }

  async listLanguages(): Promise<SapLanguage[]> {
    const data = await callAction<{ languages: SapLanguage[] }>(this.transport, 'list_languages', {});
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
    await this.assertActionSupported('list_texts', params.target_type);
    const data = await callAction<ListTextsResult>(this.transport, 'list_texts', { ...params });
    return { ...data, texts: (data.texts ?? []).map(normalizeListTextEntry) };
  }

  /**
   * Merged reader for a CDS entity (target_type `cds_entity`): fan out to BOTH physical objects
   * — the data_definition view AND its metadata_extension DDLX — and concatenate their texts into
   * one set. Every CDS row keeps the `owner` the backend stamped (read from the row, NOT derived
   * from which call produced it), so the caller gets the whole translation surface in one shot and
   * DDLX labels are included automatically. Rows are NOT deduplicated across owners: a view-owned
   * and a DDLX-owned slot are distinct targets even when field_name/attribute coincide.
   */
  async getCdsEntityTexts(params: {
    object_name: string;
    language?: string;
  }): Promise<ListTextsResult> {
    // Read each physical object in turn (view first, DDLX second) and concatenate. Sequential, not
    // parallel: the capabilities probe is a process-wide cache, so back-to-back reads share one probe
    // and the merged order is deterministic.
    const parts: ListTextsResult[] = [];
    for (const owner of CDS_ENTITY_OWNERS) {
      parts.push(
        await this.getTexts({ target_type: owner, object_name: params.object_name, language: params.language }),
      );
    }
    return {
      target_type: CDS_ENTITY_TARGET,
      object_name: params.object_name,
      language: parts[0].language, // both reads use the same effective language
      texts: parts.flatMap((p) => p.texts),
    };
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
    await this.assertActionSupported('set_translation', params.target_type);
    const texts = params.texts.map(normalizeSetTextEntry);
    return callAction<SetTranslationResult>(this.transport, 'set_translation', { ...params, texts });
  }

  /**
   * Owner-routed writer. Each incoming row is routed to a backend target_type by its own `owner`
   * ("data_definition" -> the view/DDLS, "metadata_extension" -> the DDLX); a row WITHOUT `owner`
   * (e.g. hand-built, or a non-CDS single-object write) falls back to the call's explicit
   * `target_type`, exactly as today. Rows are grouped so each distinct physical object is written
   * — and therefore locked/transported — exactly once. Positional slots keep their index
   * (normalizeSetTextEntry). Returns one result per physical object written.
   */
  async setTextsByOwner(
    params: {
      target_type: string;
      object_name: string;
      language: string;
      transport: string;
      texts: SetTextEntry[];
    } & I18nSelectors,
  ): Promise<SetTranslationResult[]> {
    const { texts, target_type, ...rest } = params;
    const groups = new Map<string, SetTextEntry[]>();
    for (const entry of texts) {
      const target = entry.owner || target_type;
      const group = groups.get(target);
      if (group) group.push(entry);
      else groups.set(target, [entry]);
    }
    const results: SetTranslationResult[] = [];
    for (const [target, groupTexts] of groups) {
      results.push(await this.setTranslation({ ...rest, target_type: target, texts: groupTexts }));
    }
    return results;
  }
}
