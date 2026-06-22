import { GetTextsSchema, I18nCore, TOOLS, narrowListTexts } from '@lisa/core';
import { OperationType, defineTool } from 'arc-1/public';
import { ctxHttpTransport } from '../transport.js';

/**
 * LISA TranslateGetTexts (whole-object reader, list_texts), as an ARC-1 extension tool.
 *
 * Reuses the core reader — including the position decomposition + guaranteed `populated`
 * (normalizeListTextEntry) — then applies the same client-side field_name/position narrowing
 * the standalone server does. READ op exposed as POST, hence scope:'write' (see ListLanguages note).
 */
export default defineTool({
  name: 'Custom_TranslateGetTexts',
  description: TOOLS.TranslateGetTexts.description,
  schema: GetTextsSchema,
  policy: { scope: 'write', opType: OperationType.Read },
  availableOn: 'all',
  async handler(args, ctx) {
    const a = args as {
      target_type: string;
      object_name: string;
      language?: string;
      text_pool_owner_type?: string;
      field_name?: string;
      position?: string;
    };
    const core = new I18nCore(ctxHttpTransport(ctx.http));

    const result = await core.getTexts({
      target_type: a.target_type,
      object_name: a.object_name,
      language: a.language,
      text_pool_owner_type: a.text_pool_owner_type,
    });

    const texts = narrowListTexts(result.texts, { field_name: a.field_name, position: a.position });

    return { content: [{ type: 'text', text: JSON.stringify({ ...result, texts }, null, 2) }] };
  },
});
