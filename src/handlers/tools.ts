/**
 * MCP tool definitions for SAP object translation.
 *
 * These schemas mirror the wire contract of the ABAP handler class
 * `zcl_i18n_service` exactly:
 *   - the action is the last segment of the URL path (handled in i18n-client),
 *   - every parameter is sent in the JSON request body,
 *   - object kinds are the XCO *semantic* target types (data_element, domain, …),
 *     NOT DDIC short codes (DTEL, DOMA, …),
 *   - text entries use { attribute, value }.
 */

import { z } from 'zod';
import type { Capabilities } from '../sap/i18n-client.js';

// ─── Shared argument schemas ──────────────────────────────────────────────────

/**
 * XCO i18n target type. These are the exact literals the ABAP `CASE lv_target_type`
 * branches on — see ZCL_I18N_SERVICE. They are semantic object kinds, not DDIC codes.
 */
export const TargetTypeSchema = z
  .enum([
    'data_element',
    'domain',
    'data_definition',
    'message_class',
    'text_pool',
    'metadata_extension',
    'application_log_object',
    'business_configuration_object',
  ])
  .describe(
    'XCO translation target type: data_element (DTEL), domain (DOMA fixed-value texts), ' +
      'data_definition (CDS DDLS entity/field labels), message_class (MSAG), ' +
      'text_pool (class/function-group text symbols), metadata_extension (DDLX UI labels), ' +
      'application_log_object (APLO), business_configuration_object (SMBC). ' +
      'NOTE: a CDS view (data_definition) often has its UI labels defined/overridden in a separate ' +
      "metadata extension (DDLX). To translate ALL of a view's texts, also query the corresponding " +
      'metadata_extension object (its own DDLX name, not the view name). ' +
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
              'message_short_text (message_class), fixed_value_description (domain)',
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
              'the top-level position for THIS entry. Sent as a string.',
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
      '(level, field_name, position, attribute), its value, and a `populated` flag ' +
      '(false = the slot exists but is empty in this language, i.e. still to translate). ' +
      'To list only filled texts, keep entries with populated=true; to compare two languages, ' +
      'call it once per language and diff on (key, populated, value). ' +
      'When reading a CDS view (target_type=data_definition), remember its UI labels may live in a ' +
      'separate metadata extension (DDLX): query the matching metadata_extension object as well to ' +
      'cover every translatable text.',
    inputSchema: GetTextsSchema,
  },
  TranslateSetTexts: {
    description:
      'Write or update translations for an SAP object. Provide the transport request and an array ' +
      'of { attribute, value } entries. Each entry may also carry its own field_name (and position) ' +
      'to target a specific CDS field — so all fields of one data_definition / metadata_extension ' +
      '(e.g. every ui_lineitem_label) can be written in a SINGLE call, locking the object only once. ' +
      'Entries without their own field_name/position fall back to the top-level field_name and ' +
      '`position` from TranslateGetTexts.',
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
    return `On THIS SAP system, '${action}' supports these target_type values: ${allowed.join(', ')}. Any other target_type is rejected before reaching SAP.`;
  }
  return 'STACK DIFFERENCES: public cloud / BTP ABAP Environment and on-premise / private cloud support DIFFERENT object types per operation, and the supported set can also differ by system version. A target_type the target system does not support for this operation is rejected up-front.';
}
