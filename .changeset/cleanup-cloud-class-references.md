---
'@lisa-mcp/arc1-extension': patch
---

Docs: remove stale `ZCL_I18N_SERVICE_CLOUD` references. The cloud handler class was renamed to
`ZCL_I18N_SERVICE` in LISA 0.8.3 (all three platform variants share the name, separated by folder);
the published README and the plugin header comment still said "`ZCL_I18N_SERVICE` (or `_CLOUD`)".
No functional change.
