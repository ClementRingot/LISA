# LISA documentation

**LISA** (Localization & Internationalization Service for ABAP) is an MCP server that lets AI assistants read, write and compare **SAP object translations**. It has two halves:

- an **ABAP HTTP service** (`ZCL_I18N_SERVICE`) you install in your SAP system, and
- this **Node.js MCP server**, which authenticates callers and forwards their requests to that service.

## Start here

1. **[Quickstart](./quickstart.md)** — the fastest path to a working setup.
2. **[ABAP service setup](./abap-service-setup.md)** — import the class and publish/enable the HTTP service.
3. **[MCP tools usage](./mcp-usage.md)** — the 3 tools, with examples.
4. **[Text tables (`text_table`)](./text-table.md)** — translating delivery-class C/S tables (e.g. `T005T`).

## Reference

- **[Configuration reference](./configuration-reference.md)** — every environment variable.
- **[Authentication](./authentication.md)** — the auth model and the supported methods.
- **[Architecture](./architecture.md)** — how the components fit together.
- **[Wire-contract evolution & platform divergence](./wire-contract-evolution.md)** — why one MCP serves every platform, the per-platform ABAP split, and how to grow the contract / add a `target_type` or parameter as the XCO APIs diverge.

## Operations

- **[Local development](./local-development.md)** — dev loop, lint, build.
- **[BTP deployment](./btp-deployment.md)** — Cloud Foundry / MTA (standalone server).
- **[ARC-1 extension deployment](./arc1-extension-deployment.md)** — run LISA's tools in-process inside ARC-1.
- **[Releasing](./releasing.md)** — cut a tagged release; which ref to deploy.

## At a glance

| | |
|--|--|
| **Tools** | `TranslateListLanguages`, `TranslateGetTexts`, `TranslateSetTexts` |
| **Object types** | data elements, domains, CDS views, CDS metadata extensions, message classes, class/FG text pools, application log objects, business configuration objects |
| **Transports** | `http-streamable` (default) and `stdio` |
| **Auth** | none (stdio/local), API key, OIDC/JWT, XSUAA (BTP) |
| **Built like** | [ARC-1](https://github.com/arc-mcp/arc-1) |
