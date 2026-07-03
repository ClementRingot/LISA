# @lisa-mcp/server

[![npm](https://img.shields.io/npm/v/@lisa-mcp/server?label=%40lisa-mcp%2Fserver&logo=npm)](https://www.npmjs.com/package/@lisa-mcp/server)

**LISA** (Localization & Internationalization Service for ABAP) as a standalone
[Model Context Protocol](https://modelcontextprotocol.io) server: 3 focused tools —
`TranslateListLanguages`, `TranslateGetTexts`, `TranslateSetTexts` — that let AI assistants
read, write and compare **SAP object translations** (data elements, domains, CDS views,
message classes, text pools, text tables, …) through the XCO i18n APIs.

The server is **one half** of a working setup: it talks to a small ABAP HTTP service
(`ZCL_I18N_SERVICE`) that you import into the target SAP system. The ABAP sources and full
documentation live in the [LISA repository](https://github.com/ClementRingot/LISA).

## Run locally (development / testing)

```bash
npx @lisa-mcp/server
```

Configure via environment variables (or a `.env` next to where you run it):

```bash
SAP_URL=https://your-abap-system.example.com
SAP_USERNAME=ABAP_USER
SAP_PASSWORD=secret
SAP_CLIENT=100
SAP_I18N_SERVICE_PATH=/sap/bc/http/sap/zi18n_service
MCP_TRANSPORT=http-streamable      # or "stdio"
PORT=8080
```

HTTP mode serves the MCP endpoint on `http://localhost:8080/mcp` (with a `/health` probe).
For stdio, point your MCP client at the binary directly:

```json
{
  "mcpServers": {
    "lisa": {
      "command": "npx",
      "args": ["@lisa-mcp/server"],
      "env": { "MCP_TRANSPORT": "stdio", "SAP_URL": "…", "SAP_USERNAME": "…", "SAP_PASSWORD": "…" }
    }
  }
}
```

> ⚠️ Local mode has no XSUAA in front of it and uses a single technical SAP user. Keep it on
> your machine — production runs on SAP BTP with XSUAA + principal propagation.

## Deploy to SAP BTP from npm (no clone)

The package ships an MTA template under [`templates/mta/`](./templates/mta/) — a minimal
deploy project that `npm install`s this package instead of building the repo from source:

```bash
cp -r node_modules/@lisa-mcp/server/templates/mta lisa-deploy && cd lisa-deploy
# edit mta.yaml (destinations, service path), then:
mbt build && cf deploy mta_archives/*.mtar
```

It provisions XSUAA (authentication only — no scopes/roles) and the Destination service, and
upgrading LISA is just a version bump in `app/package.json`. See the template's
[README](./templates/mta/README.md) and
[docs: BTP deployment](https://github.com/ClementRingot/LISA/blob/main/docs_page/btp-deployment.md).

## Configuration & docs

Every environment variable (auth methods, destinations, OAuth DCR, rate limits) is documented in
[docs: configuration reference](https://github.com/ClementRingot/LISA/blob/main/docs_page/configuration-reference.md);
the authentication model (XSUAA / OIDC / API key — authentication only, SAP enforces rights) in
[docs: authentication](https://github.com/ClementRingot/LISA/blob/main/docs_page/authentication.md).

Already running [ARC-1](https://github.com/arc-mcp/arc-1)? Load LISA's tools **in-process**
instead of running a second server: [`@lisa-mcp/arc1-extension`](https://www.npmjs.com/package/@lisa-mcp/arc1-extension).

## License

[MIT](./LICENSE) © Clément Ringot
