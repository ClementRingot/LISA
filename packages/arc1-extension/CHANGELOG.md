# @lisa-mcp/arc1-extension

## 0.3.2

### Patch Changes

- 8541fc9: Docs-only republish: the npm README now documents the build-from-source alternative (clone +
  `npm run build --workspace packages/arc1-extension`, including pinning a release via
  `git checkout arc1-extension-vX.Y.Z`). No code change.

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

---

_The extension's earlier history (0.1.0 → 0.2.0, released from the product tree) is preserved in the
[frozen root CHANGELOG at the v0.9.0 tag](https://github.com/ClementRingot/LISA/blob/v0.9.0/CHANGELOG.md)._
