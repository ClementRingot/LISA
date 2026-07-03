# @lisa-mcp/arc1-extension

[![npm](https://img.shields.io/npm/v/@lisa-mcp/arc1-extension?label=%40lisa-mcp%2Farc1-extension&logo=npm)](https://www.npmjs.com/package/@lisa-mcp/arc1-extension)

LISA's SAP object-translation tools, packaged as an **[ARC-1](https://github.com/arc-mcp/arc-1) extension** —
loaded **in-process** by an ARC-1 instance so they reuse its authenticated SAP client, safety ceiling,
scope policy, audit trail, and per-user principal propagation. No second auth stack, no second deployment.

Three tools are exposed: `Custom_TranslateListLanguages`, `Custom_TranslateGetTexts`,
`Custom_TranslateSetTexts` — the same wire contract as the standalone [LISA MCP server](https://github.com/ClementRingot/LISA),
sharing `@lisa-mcp/core`.

## Install

```bash
npm install @lisa-mcp/arc1-extension
```

The published artifact is a **single self-contained ESM bundle** at `dist/index.js`
(`@lisa-mcp/core` is inlined). `arc-1` and `zod` are **peer dependencies**: they are provided by the
host ARC-1 process at runtime — `zod` in particular MUST resolve to ARC-1's own instance, since its
registry runs `z.toJSONSchema()` on the tool schemas and plugin + registry have to share one zod.

## Use

ARC-1 loads code plugins from `ARC1_PLUGINS` — a CSV of **absolute** paths to each plugin's entry file.
Point it at the installed bundle:

```bash
ARC1_PLUGINS=/abs/path/to/node_modules/@lisa-mcp/arc1-extension/dist/index.js
SAP_ALLOW_WRITES=true
SAP_ALLOW_PLUGIN_RAW_WRITES=true        # all three tools POST → require the raw-write opt-in
SAP_I18N_SERVICE_PATH=/sap/bc/http/sap/zi18n_service   # optional override
```

> The plugin registers under the runtime name **`lisa-arc1-extension`** (its ARC-1 identity, kept
> stable across the npm rename). Requires LISA's `ZCL_I18N_SERVICE` handler class installed on the
> target SAP system (three per-platform variants — see the
> [LISA repo's `abap/` folder](https://github.com/ClementRingot/LISA/tree/main/abap)).

Full runbook — Docker image, Cloud Foundry, the write-flag rationale — in
[docs: ARC-1 extension deployment](https://github.com/ClementRingot/LISA/blob/main/docs_page/arc1-extension-deployment.md).

## Versioning

Released on its own cadence, independent of the LISA product version. Git tag `arc1-extension-vX.Y.Z`;
see [docs: Releasing](https://github.com/ClementRingot/LISA/blob/main/docs_page/releasing.md).

## License

[MIT](./LICENSE)
