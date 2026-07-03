# @lisa-mcp/arc1-extension

## 0.3.1

### Patch Changes

- 0e9536b: Docs: remove stale `ZCL_I18N_SERVICE_CLOUD` references. The cloud handler class was renamed to
  `ZCL_I18N_SERVICE` in LISA 0.8.3 (all three platform variants share the name, separated by folder);
  the published README and the plugin header comment still said "`ZCL_I18N_SERVICE` (or `_CLOUD`)".
  No functional change.

## 0.3.0

### Minor Changes

- First public npm release under `@lisa-mcp/arc1-extension`. The ARC-1 extension is now installable
  via `npm install @lisa-mcp/arc1-extension` (single self-contained ESM bundle; `arc-1` and `zod` are
  host-provided peer dependencies). Publication is automated on `arc1-extension-v*` tags.
