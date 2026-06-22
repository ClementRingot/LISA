# Local development

## Setup

```bash
npm install
cp .env.example .env     # fill in SAP_URL / SAP_USERNAME / SAP_PASSWORD / SAP_CLIENT
```

For local dev you connect **directly** to SAP (BasicAuth) — no BTP services involved. Make sure the [ABAP service](./abap-service-setup.md) is installed and reachable from your machine.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Run with `tsx` (no build step, fast iteration). |
| `npm run build` | Compile TypeScript to `dist/` via `tsc`. |
| `npm start` | Run the compiled server (`node dist/index.js`). |
| `npm run lint` | Biome check over `src/`. |
| `npm run format` | Biome format-write over `src/`. |
| `npm run clean` | Remove `dist/`. |

## Transports

- **`http-streamable`** (default) — serves the MCP endpoint at `http://localhost:8080/mcp` with a `/health` probe. Use this to test with HTTP MCP clients and to mirror production.
- **`stdio`** — set `MCP_TRANSPORT=stdio` to run as a child process launched by the MCP client. No HTTP server, no auth layer; the client passes env vars directly.

## Testing the ABAP service directly

Bypass the MCP server entirely to isolate problems:

```bash
curl -u "$SAP_USERNAME:$SAP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$SAP_URL/sap/bc/http/sap/zi18n_service/list_languages?sap-client=$SAP_CLIENT" \
  -d '{}'
```

If this works but the MCP tool doesn't, the problem is in the server config (path, auth). If this fails, the problem is in SAP (HTTP service not enabled in `UCON_HTTP_SERVICES`, authorization, or XCO availability).

## Project layout

```
packages/
├── core/                         # @lisa/core — transport-agnostic wire contract
│   └── src/
│       ├── wire.ts               # I18nTransport port + I18nCore (wire logic, ZCL_I18N_SERVICE mirror)
│       ├── schemas.ts            # Zod schemas + tool metadata (the 3 tools)
│       └── index.ts              # public exports
├── server/                       # standalone MCP server
│   └── src/
│       ├── index.ts              # entry point: resolveConfig → initLogger → start server
│       ├── handlers/
│       │   └── intent.ts         # registers tools on the MCP server, built on @lisa/core
│       ├── sap/
│       │   └── transport.ts      # btpTransport: HTTP to ABAP; BTP via @arc-mcp/xsuaa-auth/btp
│       └── server/
│           ├── config.ts         # env → Config
│           ├── server.ts         # builds & starts the MCP server
│           ├── http.ts           # Express transport, mcpAuthRouter, OAuth callback; wires @arc-mcp/xsuaa-auth
│           ├── logger.ts         # logging + audit events; toPackageLogger() adapter for @arc-mcp/xsuaa-auth
│           └── types.ts          # shared types
└── arc1-extension/               # lisa-arc1-extension — the 3 tools as an in-process ARC-1 plugin
    └── src/
        ├── transport.ts          # ctxHttpTransport: I18nTransport over ctx.http (ARC-1's SafeHttpClient)
        ├── tools/                # Custom_TranslateListLanguages.ts, Custom_TranslateGetTexts.ts, Custom_TranslateSetTexts.ts
        └── index.ts              # default-exports the Plugin
```

> The XSUAA OAuth proxy, DCR client store, OAuth state codec, chained verifier and
> BTP connectivity now live in the **[`@arc-mcp/xsuaa-auth`](https://www.npmjs.com/package/@arc-mcp/xsuaa-auth)**
> dependency (consumed in `http.ts` and `transport.ts`), not in this repo.

## Conventions

- Code style is enforced by **Biome** (`biome.json`). Run `npm run lint` before committing.
- The wire contract in `packages/core/src/wire.ts` mirrors `ZCL_I18N_SERVICE` exactly — if you change one, change the other.

## When in doubt

This project depends on **[`@arc-mcp/xsuaa-auth`](https://www.npmjs.com/package/@arc-mcp/xsuaa-auth)** for auth + BTP connectivity, and follows **[ARC-1](https://github.com/arc-mcp/arc-1)**'s patterns for HTTP transport and rate limiting. If an auth/BTP behaviour is unclear, the package (and ARC-1, from which it was extracted) is the reference implementation.
