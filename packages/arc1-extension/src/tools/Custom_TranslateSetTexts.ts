import { I18nCore, SetTranslationSchema, TOOLS } from '@lisa/core';
import type { SetTextEntry } from '@lisa/core';
import { OperationType, defineTool } from 'arc-1/public';
import { ctxHttpTransport } from '../transport.js';

/**
 * LISA TranslateSetTexts, as an ARC-1 extension tool — the actual WRITE.
 *
 * Gated: refused unless SAP_ALLOW_PLUGIN_RAW_WRITES=true + SAP_ALLOW_WRITES=true and scope:'write'.
 * The write lands in the caller-supplied `transport`; the object is locked once even when the
 * `texts` array addresses several CDS fields (per-entry field_name/position). Non-ADT path, so
 * SAP_ALLOWED_PACKAGES does not apply — SAP-side auth on ZI18N_SERVICE is the backstop.
 */
export default defineTool({
  name: 'Custom_TranslateSetTexts',
  description: TOOLS.TranslateSetTexts.description,
  schema: SetTranslationSchema,
  policy: { scope: 'write', opType: OperationType.Update },
  availableOn: 'all',
  async handler(args, ctx) {
    const a = args as {
      target_type: string;
      object_name: string;
      language: string;
      transport: string;
      texts: SetTextEntry[];
      field_name?: string;
      fixed_value?: string;
      message_number?: string;
      text_symbol_id?: string;
      text_pool_owner_type?: string;
      subobject_name?: string;
      position?: string;
    };
    const core = new I18nCore(ctxHttpTransport(ctx.http));

    // Route each row to its physical object by `owner` (CDS round-trip); rows without one fall back
    // to the call's target_type. Each object is locked/transported once; one result per object.
    const results = await core.setTextsByOwner({
      target_type: a.target_type,
      object_name: a.object_name,
      language: a.language,
      transport: a.transport,
      texts: a.texts,
      field_name: a.field_name,
      fixed_value: a.fixed_value,
      message_number: a.message_number,
      text_symbol_id: a.text_symbol_id,
      text_pool_owner_type: a.text_pool_owner_type,
      subobject_name: a.subobject_name,
      position: a.position,
    });

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  },
});
