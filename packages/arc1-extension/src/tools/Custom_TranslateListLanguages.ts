import { I18nCore, ListLanguagesSchema, TOOLS } from '@lisa/core';
import { OperationType, defineTool } from 'arc-1/public';
import { ctxHttpTransport } from '../transport.js';

/**
 * LISA TranslateListLanguages, as an ARC-1 extension tool.
 *
 * READ operation — but LISA exposes EVERY action as a POST (the ABAP handler reads the action
 * from ~path_info and parses params from the JSON body), and ctx.http gates by HTTP method, so
 * this still needs scope:'write' + SAP_ALLOW_PLUGIN_RAW_WRITES. `opType: Read` keeps the
 * DECLARED operation honest (it only reads). To make this a clean scope:'read', expose
 * list_languages over GET (query-string) in ZCL_I18N_SERVICE — see the package README.
 */
export default defineTool({
  name: 'Custom_TranslateListLanguages',
  description: TOOLS.TranslateListLanguages.description,
  schema: ListLanguagesSchema,
  policy: { scope: 'write', opType: OperationType.Read },
  availableOn: 'all',
  async handler(_args, ctx) {
    const core = new I18nCore(ctxHttpTransport(ctx.http));
    const languages = await core.listLanguages();
    return { content: [{ type: 'text', text: JSON.stringify(languages, null, 2) }] };
  },
});
