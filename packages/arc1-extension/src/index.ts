import type { Plugin } from 'arc-1/public';
import getTexts from './tools/Custom_TranslateGetTexts.js';
import listLanguages from './tools/Custom_TranslateListLanguages.js';
import setTexts from './tools/Custom_TranslateSetTexts.js';

/**
 * LISA as an ARC-1 extension — the three translation tools loaded IN-PROCESS by an ARC-1
 * instance, reusing its authenticated SAP client, safety ceiling, scope policy, audit, and
 * per-user principal propagation. No second auth stack, no second deployment.
 *
 * Load it on the ARC-1 side with:
 *   ARC1_PLUGINS=/abs/path/to/lisa-arc1-extension/dist/index.js
 *   SAP_ALLOW_WRITES=true
 *   SAP_ALLOW_PLUGIN_RAW_WRITES=true        # all three tools POST → require the raw-write opt-in
 *   SAP_I18N_SERVICE_PATH=/sap/bc/http/sap/zi18n_service   # optional override
 *
 * Requires LISA's ZCL_I18N_SERVICE (or _CLOUD) handler class imported on the target SAP system.
 * See docs_page/arc1-extension-deployment.md for the full runbook.
 */
const plugin: Plugin = {
  name: 'lisa-arc1-extension',
  version: '0.1.0',
  apiVersion: 1,
  tools: [listLanguages, getTexts, setTexts],
};

export default plugin;
