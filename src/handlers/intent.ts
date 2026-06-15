import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { I18nClient } from '../sap/i18n-client.js';
import { getLogger } from '../server/logger.js';
import type { Config } from '../server/types.js';
import { GetTextsSchema, ListLanguagesSchema, SetTranslationSchema, TOOLS } from './tools.js';

function formatError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `Error: ${msg}`;
}

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function registerTranslationTools(server: McpServer, config: Config, userJwt?: string): void {
  const log = getLogger();
  const client = new I18nClient(config, userJwt);

  // No MCP-level authorization: every authenticated principal gets all tools.
  // The user's JWT is propagated to SAP, whose own authorization objects decide
  // what may actually be read / written / translated.

  // ── TranslateListLanguages ────────────────────────────────────────────────
  server.tool(
    'TranslateListLanguages',
    TOOLS.TranslateListLanguages.description,
    ListLanguagesSchema.shape,
    async () => {
      try {
        const languages = await client.listLanguages();
        return { content: [{ type: 'text', text: json(languages) }] };
      } catch (e) {
        log.error('TranslateListLanguages failed', { err: (e as Error).message });
        return { content: [{ type: 'text', text: formatError(e) }], isError: true };
      }
    },
  );

  // ── TranslateGetTexts ─────────────────────────────────────────────────────
  // Whole-object reader (list_texts). The optional scope params (field_name, position) are
  // applied as client-side filters: the ABAP list_texts enumerates every field/position, so we
  // narrow the result here rather than asking the server to.
  server.tool('TranslateGetTexts', TOOLS.TranslateGetTexts.description, GetTextsSchema.shape, async (args) => {
    try {
      const result = await client.getTexts({
        target_type: args.target_type,
        object_name: args.object_name,
        language: args.language,
        text_pool_owner_type: args.text_pool_owner_type,
      });

      let texts = result.texts;
      if (args.field_name) {
        const fieldName = args.field_name.toUpperCase();
        texts = texts.filter((t) => t.field_name.toUpperCase() === fieldName);
      }
      if (args.position) {
        texts = texts.filter((t) => t.position === args.position);
      }

      return { content: [{ type: 'text', text: json({ ...result, texts }) }] };
    } catch (e) {
      log.error('TranslateGetTexts failed', { err: (e as Error).message });
      return { content: [{ type: 'text', text: formatError(e) }], isError: true };
    }
  });

  // ── TranslateSetTexts ─────────────────────────────────────────────────────
  server.tool('TranslateSetTexts', TOOLS.TranslateSetTexts.description, SetTranslationSchema.shape, async (args) => {
    try {
      const result = await client.setTranslation({
        target_type: args.target_type,
        object_name: args.object_name,
        language: args.language,
        transport: args.transport,
        texts: args.texts,
        field_name: args.field_name,
        fixed_value: args.fixed_value,
        message_number: args.message_number,
        text_symbol_id: args.text_symbol_id,
        text_pool_owner_type: args.text_pool_owner_type,
        subobject_name: args.subobject_name,
        position: args.position,
      });
      return { content: [{ type: 'text', text: json(result) }] };
    } catch (e) {
      log.error('TranslateSetTexts failed', { err: (e as Error).message });
      return { content: [{ type: 'text', text: formatError(e) }], isError: true };
    }
  });
}
