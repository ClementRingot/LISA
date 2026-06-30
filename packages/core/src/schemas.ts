/**
 * MCP/tool input schemas for SAP object translation.
 *
 * These schemas mirror the wire contract of the ABAP handler class
 * `zcl_i18n_service` exactly:
 *   - the action is the last segment of the URL path (handled in wire.ts),
 *   - every parameter is sent in the JSON request body,
 *   - object kinds are the XCO *semantic* target types (data_element, domain, …),
 *     NOT DDIC short codes (DTEL, DOMA, …),
 *   - text entries use { attribute, value }.
 */

import { z } from 'zod';
import { CDS_ENTITY_OWNERS, CDS_ENTITY_TARGET, type Capabilities } from './wire.js';

// ─── Shared argument schemas ──────────────────────────────────────────────────

/**
 * XCO i18n target type. These are the exact literals the ABAP `CASE lv_target_type`
 * branches on — see ZCL_I18N_SERVICE. They are semantic object kinds, not DDIC codes.
 */
export const TargetTypeSchema = z
  .enum([
    'cds_entity',
    'data_element',
    'domain',
    'data_definition',
    'message_class',
    'text_pool',
    'metadata_extension',
    'application_log_object',
    'business_configuration_object',
    'text_table',
  ])
  .describe(
    'XCO translation target type: data_element (DTEL), domain (DOMA fixed-value texts), ' +
      'data_definition (CDS DDLS entity/field labels), message_class (MSAG), ' +
      'text_pool (class/function-group text symbols), metadata_extension (DDLX UI labels), ' +
      'application_log_object (APLO), business_configuration_object (SMBC), ' +
      'text_table (a translatable text table — a DB table with delivery class C/S and exactly one ' +
      'LANG key field, e.g. T005T; its non-key character columns are the text attributes). ' +
      'cds_entity (VIRTUAL, LISA-only): a convenience target that bundles the texts of ONE named CDS ' +
      'entity. It is NOT a backend type — LISA fans it out to the two real targets that hold that ' +
      'entity’s texts: data_definition (the view/DDLS itself) and metadata_extension (its DDLX). On read, ' +
      'LISA calls both and returns the merged texts, each row carrying an `owner` field ' +
      '(data_definition | metadata_extension). On write, LISA groups the provided texts by their `owner` ' +
      'and writes each group back to the matching real target in its own call (so each physical object is ' +
      'locked once); the per-row `owner` returned by a read routes the write, so pass the rows back unchanged. ' +
      'SCOPE: cds_entity covers the NAMED entity and its OWN DDLX ONLY. It does NOT reach the ' +
      'underlying/parent views of an `as projection on` chain — e.g. the interface view ZI_… behind a ' +
      'projection ZC_… — each of which carries its OWN @EndUserText.label and needs its OWN cds_entity (or ' +
      'data_definition) call. On a RAP stack, run ONE pass per distinct CDS entity (one view = one call), ' +
      'cds_entity on each. cds_entity is valid WITH or WITHOUT a DDLX: when the entity has no metadata ' +
      'extension the data_definition is still written and the DDLX sub-call simply finds 0 texts (the call ' +
      'stays valid but may report a partial status) — for a single-object view with no DDLX, data_definition ' +
      'direct is cleaner. data_definition and metadata_extension remain available to address ONE physical ' +
      'object explicitly (single-owner, unmerged). ' +
      'The object types actually available on the target system are stated per tool (see each tool description).',
  );

export const LanguageSchema = z
  .string()
  .min(1)
  .max(2)
  .describe('Language — ISO 639-1 (EN, DE, FR…) or SAP SPRAS single-char code (E, D, F…)');

/**
 * Optional selectors read by the ABAP handler to disambiguate sub-objects within a target.
 * Only the ones relevant to a given target_type are used; the rest are ignored server-side.
 */
const SelectorShape = {
  field_name: z
    .string()
    .optional()
    .describe('CDS field name (data_definition / metadata_extension) to scope to a single field'),
  fixed_value: z.string().optional().describe('Domain fixed value (lower limit) — required for target_type=domain'),
  message_number: z.string().optional().describe('Message number — required for target_type=message_class'),
  text_symbol_id: z.string().optional().describe('Text symbol id (e.g. "001") — for target_type=text_pool'),
  text_pool_owner_type: z
    .enum(['class', 'function_group'])
    .optional()
    .describe('Owner of the text pool — class (default) or function_group'),
  subobject_name: z.string().optional().describe('Sub-object name (e.g. application-log sub-object)'),
  position: z
    .string()
    .optional()
    .describe('1-based position for repeatable UI annotations (metadata_extension). Sent as a string.'),
  language_key_field_name: z
    .string()
    .optional()
    .describe(
      'REQUIRED for target_type=text_table: the LANG key field of the text table (e.g. SPRAS). ' +
        'Ignored by every other target_type.',
    ),
  master_key_fields: z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .optional()
    .describe(
      'REQUIRED for target_type=text_table: the master key fields that pin ONE record — every key ' +
        'field EXCEPT the language field — as [{ name, value }] (e.g. [{ "name": "LAND1", "value": "DE" }]). ' +
        'Must fix all master keys so a single record is targeted. Ignored by every other target_type.',
    ),
} as const;

// ─── Tool input schemas ───────────────────────────────────────────────────────

export const ListLanguagesSchema = z.object({});

export const GetTextsSchema = z.object({
  target_type: TargetTypeSchema,
  object_name: z.string().min(1).describe('Technical name of the SAP object, e.g. ZCL_MY_CLASS'),
  language: LanguageSchema.optional().describe(
    'Language to read in (EN, DE, FR…). Optional — when omitted, the object is read in its ' +
      'original language and the effective language is returned in the response.',
  ),
  ...SelectorShape,
});

export const SetTranslationSchema = z.object({
  target_type: TargetTypeSchema,
  object_name: z.string().min(1).describe('Technical name of the SAP object'),
  language: LanguageSchema,
  transport: z.string().min(1).describe('Transport request number, e.g. K900001'),
  texts: z
    .array(
      z.object({
        attribute: z
          .string()
          .min(1)
          .describe(
            'XCO text attribute, e.g. short_field_label / medium_field_label / long_field_label / ' +
              'heading_field_label (data_element), endusertext_label (data_definition/metadata_extension), ' +
              'message_short_text (message_class), fixed_value_description (domain), ' +
              'or a text column name like LANDX (text_table)',
          ),
        value: z.string().describe('Translated text value'),
        field_name: z
          .string()
          .optional()
          .describe(
            'Per-entry CDS field name (data_definition / metadata_extension). When set it overrides the ' +
              'top-level field_name for THIS entry, letting one call address several fields of the same ' +
              'object. Omit (or leave the top-level field_name empty) for entity-level texts.',
          ),
        position: z
          .string()
          .optional()
          .describe(
            'Per-entry 1-based position for repeatable UI annotations (e.g. ui_lineitem_label). Overrides ' +
              'the top-level position for THIS entry. Sent as a string. Equivalently, the attribute may keep ' +
              'the bracketed form it was read in (e.g. "ui_lineitem_label[2]") — the index round-trips either ' +
              'way and is never renumbered.',
          ),
        owner: z
          .string()
          .optional()
          .describe(
            'Required when target_type=cds_entity: which physical object this text belongs to — ' +
              '"data_definition" (view/DDLS) or "metadata_extension" (DDLX). LISA routes each row to the ' +
              'matching backend target by this value (a cds_entity write with any row missing `owner` is ' +
              'rejected — LISA never guesses). Pass through verbatim the `owner` that TranslateGetTexts ' +
              'stamped on the row. For entity-level texts (the view’s own endusertext_label) leave ' +
              'field_name empty. Positional UI labels must keep their `position` (string, 1-based). ' +
              'Ignored for a single-target (data_definition / metadata_extension) or non-CDS write.',
          ),
      }),
    )
    .min(1)
    .describe(
      'Array of text entries to write. Each entry may carry its own field_name/position so that ' +
        'translations for MULTIPLE fields of one object (e.g. several ui_lineitem_label labels of a CDS ' +
        'view) are written in a single call — the object is then locked only once.',
    ),
  ...SelectorShape,
});

// ─── Tool metadata ────────────────────────────────────────────────────────────

export const TOOLS = {
  TranslateListLanguages: {
    description: 'List all languages installed on the SAP system.',
    inputSchema: ListLanguagesSchema,
  },
  TranslateGetTexts: {
    description:
      "Read all translatable texts of an SAP object in a given language, or in the object's " +
      'original language when none is specified. Returns every text slot with its full key ' +
      '(level, field_name, attribute), its value, and a `populated` flag ' +
      '(false = the slot exists but is empty in this language, i.e. still to translate). ' +
      'To list only filled texts, keep entries with populated=true; to compare two languages, ' +
      'call it once per language and diff on (key, populated, value). ' +
      'For a CDS entity use target_type=cds_entity: a single call returns the merged texts of ONE named ' +
      'entity — the view itself (data_definition) AND its OWN metadata extension/DDLX (metadata_extension) ' +
      'together, so the DDLX labels come back without a separate metadata_extension call. This covers the ' +
      'NAMED entity ONLY: it does NOT read the underlying/parent views of an `as projection on` chain (e.g. ' +
      'the interface view ZI_… behind a projection ZC_…), which carry their own labels — read EACH entity of ' +
      'the stack with its own cds_entity call. Each cds_entity row always includes an `owner` ' +
      '("data_definition" or "metadata_extension") identifying the physical object it lives in, and a ' +
      '`position` (string, 1-based) for positional UI labels. Positional labels keep the BARE attribute ' +
      '(e.g. "ui_lineitem_label") plus that separate `position` — they are NOT merged into ' +
      '"ui_lineitem_label[1]". Pass `owner`, `position`, field_name and attribute back to ' +
      'TranslateSetTexts(cds_entity) VERBATIM for a correct round-trip.',
    inputSchema: GetTextsSchema,
  },
  TranslateSetTexts: {
    description:
      'Write or update translations for an SAP object. Provide the transport request and an array ' +
      'of { attribute, value } entries. Each entry may also carry its own field_name (and position) ' +
      'to target a specific CDS field — so all fields of one object (e.g. every ui_lineitem_label) ' +
      'can be written in a SINGLE call, locking the object only once. ' +
      'For target_type=cds_entity, EVERY row must carry the `owner` ("data_definition" or ' +
      '"metadata_extension") that TranslateGetTexts stamped: LISA groups the rows by `owner` and writes ' +
      'each group back to the matching physical object (view vs DDLX) in its own call, each ' +
      'locked/transported once. This writes the NAMED entity and its OWN DDLX ONLY — NOT the ' +
      'underlying/parent views of an `as projection on` chain (e.g. the interface view ZI_… behind a ' +
      'projection ZC_…); translate EACH entity of the stack with its own cds_entity call. A cds_entity ' +
      'write with any row missing `owner` is REJECTED (LISA never guesses the object). Entity-level texts ' +
      '(the view’s own endusertext_label) must go out with an EMPTY field_name; positional UI labels keep ' +
      'the bare attribute plus their `position` (string, 1-based) — never renumber or bracket it. The result ' +
      'reports, per owner, how many texts were written and the sub-call status; writes are not atomic across ' +
      'the two objects, so a partial write returns success=false with both outcomes (a cds_entity write to a ' +
      'view with no DDLX is still valid — the metadata_extension sub-call just finds nothing; for such ' +
      'single-object views, data_definition direct avoids the empty DDLX sub-call). ' +
      'For the single targets (data_definition / metadata_extension and non-CDS types) nothing changes: ' +
      'one 1:1 backend write, and entries without their own field_name/position fall back to the ' +
      'top-level field_name and `position`.',
    inputSchema: SetTranslationSchema,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/**
 * Per-action sentence appended to a tool's description so the agent knows up-front which
 * target_type values THIS system accepts for the operation. When the backend declares an
 * allow-list for the action we state it concretely; otherwise we fall back to the generic
 * stack-differences caveat (older handler / capabilities probe unavailable).
 */
export function supportedTargetTypesNote(action: string, capabilities: Capabilities | null): string {
  const allowed = capabilities?.[action];
  if (allowed && allowed.length > 0) {
    // `cds_entity` is a LISA-synthesized target: it never reaches the backend (the MCP fans it out to
    // data_definition + metadata_extension — see intent.ts), so the handler's allow-list won't contain
    // it. Advertise it ourselves whenever BOTH physical owners are supported for this action, so the
    // agent knows the merged CDS surface is available for this operation (read AND write) without each
    // ABAP variant having to hardcode the virtual type. Guarded against duplication if a handler does
    // list it.
    const types = [...allowed];
    if (CDS_ENTITY_OWNERS.every((owner) => allowed.includes(owner)) && !types.includes(CDS_ENTITY_TARGET)) {
      types.push(CDS_ENTITY_TARGET);
    }
    return `On THIS SAP system, '${action}' supports these target_type values: ${types.join(', ')}. Any other target_type is rejected before reaching SAP.`;
  }
  return 'STACK DIFFERENCES: public cloud / BTP ABAP Environment and on-premise / private cloud support DIFFERENT object types per operation, and the supported set can also differ by system version. A target_type the target system does not support for this operation is rejected up-front.';
}
