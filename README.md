# LISA — Localization & Internationalization Service for ABAP

> Let AI assistants read, write and compare **SAP object translations** through a single, secure MCP server.

**LISA** (Localization & Internationalization Service for ABAP) is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants (Claude, Cursor, VS Code, …) manage the translation of SAP repository objects — data elements, domains, CDS views, message classes, class/function-group text pools, and more — without leaving the chat.

It is built the same way as [**ARC-1**](https://github.com/marianfoo/arc-1) (same XSUAA auth proxy, same BTP connectivity model, same Express/MCP-SDK transport), but instead of the full ADT toolset it exposes **3 focused translation tools** backed by a small ABAP HTTP service that wraps SAP's [XCO i18n APIs](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/internationalization-i18n).

> **Deployment target:** `LISA` is designed to run on **SAP BTP (Cloud Foundry)** — that is the primary, supported way to use it (XSUAA login + principal propagation to SAP). Running it **locally** is fully supported too, but it is meant for **development and testing**, not production. The two paths are [Part 2 (BTP)](#part-2--deploy-to-sap-btp-recommended) and [Part 3 (local)](#part-3--run-locally-development--testing) below.

---

## How it works

```
┌──────────────┐   MCP/HTTP    ┌─────────────────────┐   HTTPS (JSON)   ┌──────────────────────┐
│  AI assistant │ ────────────▶ │  LISA MCP │ ───────────────▶ │  SAP ABAP system     │
│ (Claude/IDE)  │   3 tools     │  (Node.js, this repo)│  /zi18n_service  │  ZCL_I18N_SERVICE    │
└──────────────┘ ◀──────────── └─────────────────────┘ ◀─────────────── │  → XCO i18n APIs     │
                                                                          └──────────────────────┘
```

There are **two halves** to a working setup:

1. **The ABAP service** — a handler class (`ZCL_I18N_SERVICE`) that you import into your SAP system and expose as an ABAP **HTTP service**. It does the actual translation work using the XCO i18n APIs. → see [`abap/`](./abap) and [docs: ABAP service setup](./docs_page/abap-service-setup.md).
2. **The MCP server** — this Node.js project. It authenticates the caller, propagates their identity to SAP, and translates MCP tool calls into HTTP calls to the ABAP service.

---

## The 3 tools

| Tool | What it does |
|------|--------------|
| `TranslateListLanguages` | List all languages installed on the SAP system. |
| `TranslateGetTexts` | Read all translatable texts of an object in a given language (or its original language when none is given). Each slot comes back with its full key (`level`, `field_name`, `position`, `attribute`), its `value`, and a `populated` flag (`false` = empty in this language = still to translate). |
| `TranslateSetTexts` | Write/update translations (requires a transport request). |

> **Discover / list / compare** all collapse into `TranslateGetTexts`: read with no `language` to see the original-language slots, keep `populated === true` to list only filled texts, and call it once per language and diff on `(key, populated, value)` to compare.

### Supported object types (`target_type`)

These are XCO **semantic** literals, not DDIC short codes:

| `target_type` | SAP object | Typical attributes |
|---------------|-----------|--------------------|
| `data_element` | Data element (DTEL) | `short_field_label`, `medium_field_label`, `long_field_label`, `heading_field_label` |
| `domain` | Domain fixed-value texts (DOMA) | `fixed_value_description` |
| `data_definition` | CDS view (DDLS) entity/field labels | `endusertext_label` |
| `message_class` | Message class (MSAG) | `message_short_text` |
| `text_pool` | Class / function-group text symbols | text symbol values |
| `metadata_extension` | CDS metadata extension (DDLX) UI labels | `endusertext_label` |
| `application_log_object` | Application log object (APLO) | object / sub-object texts |
| `business_configuration_object` | Business configuration object (SMBC) | description texts |

---

## Use it alongside an ADT MCP server

`LISA` is focused on the **translation** step — it deliberately does *not* discover objects or manage transports. For an interactive, AI-driven workflow it is designed to be used **next to an ADT MCP server** (e.g. [ARC-1](https://github.com/marianfoo/arc-1)), which provides the surrounding capabilities:

- **object discovery** — find the data element / CDS view / message class to translate;
- **transport handling** — locate or create the transport request that `TranslateSetTexts` requires;
- **inspection** — read the object before translating it.

Typical division of labour: the **ADT MCP** finds the object and a transport → **LISA** reads, writes and compares its translations. On its own, `LISA` still works whenever the object name and transport are already known (e.g. batch or scripted translation).

---

## Prerequisites

- An SAP system with the **XCO i18n APIs** available (S/4HANA 2022+ / ABAP Platform 2022+ / ABAP Cloud) and the new HTTP handler model (`IF_HTTP_SERVICE_EXTENSION`).
- Authorization to import a class, create an ABAP **HTTP service** (ADT), and enable it via `UCON_HTTP_SERVICES`.
- **Node.js 22.x** to run the MCP server.
- For production: an **SAP BTP** subaccount (Cloud Foundry) with XSUAA, Destination and Connectivity services.

---

## Part 1 — Install the ABAP service

The ABAP objects to copy into your **target SAP system** live in [`abap/`](./abap):

| File | Object | Purpose |
|------|--------|---------|
| [`abap/zif_vsp_service.intf.abap`](./abap/zif_vsp_service.intf.abap) | `ZIF_VSP_SERVICE` | Shared response/message types. |
| [`abap/zcl_vsp_utils.clas.abap`](./abap/zcl_vsp_utils.clas.abap) | `ZCL_VSP_UTILS` | JSON helpers + parameter extraction. |
| [`abap/zcl_i18n_service.clas.abap`](./abap/zcl_i18n_service.clas.abap) | `ZCL_I18N_SERVICE` | The HTTP handler (`IF_HTTP_SERVICE_EXTENSION`). |

Import them (abapGit, or via ADT in the order above), create an ABAP **HTTP service** whose handler class is `ZCL_I18N_SERVICE`, and **enable** it in `UCON_HTTP_SERVICES` (S/4HANA 2022+). Point the MCP at its URL (default `/sap/bc/http/sap/zi18n_service`).

👉 Full step-by-step instructions: **[docs: ABAP service setup](./docs_page/abap-service-setup.md)**.

---

## Part 2 — Deploy to SAP BTP (recommended)

This is the **main way to run `LISA`**. It deploys to Cloud Foundry as an MTA and uses **XSUAA for authentication only** — there are **no scopes, role templates or role collections**. XSUAA proves the caller's identity; the JWT is propagated to SAP (principal propagation via the Destination + Connectivity services), and **SAP's own authorization objects** decide what each user may read, write or translate. Every authenticated user gets all 3 tools.

```bash
npm install
npm run build
mbt build           # produces mta_archives/lisa_0.1.0.mtar
cf deploy mta_archives/lisa_0.1.0.mtar
```

Then set the DCR signing secret (one-off) and point your MCP client at the deployed URL:

```bash
cf set-env lisa-mcp LISA_DCR_SIGNING_SECRET "$(openssl rand -hex 32)"
cf restage lisa-mcp
```

```json
{
  "mcpServers": {
    "lisa": { "url": "https://lisa-<space>.<domain>/mcp" }
  }
}
```

The client is redirected through XSUAA login on first use; its identity is then propagated to SAP per call.

👉 Full guide: **[docs: BTP deployment](./docs_page/btp-deployment.md)** · **[docs: authentication](./docs_page/authentication.md)** · the [`mta.yaml`](./mta.yaml) / [`xs-security.json`](./xs-security.json).

> **Why `LISA_DCR_SIGNING_SECRET`?** Without it the OAuth dynamic-client store signs with the XSUAA `clientsecret`, which `cf deploy` rotates — invalidating all cached MCP client registrations on every deploy. It's a secret, so it lives in `cf set-env`, not `mta.yaml`.

---

## Part 3 — Run locally (development & testing)

For local development you connect **directly** to SAP (BasicAuth) — no BTP services involved. This path is for trying things out and developing the server; **production should run on BTP** (Part 2).

```bash
git clone <this-repo>
cd LISA
npm install
cp .env.example .env      # then edit .env
npm run dev               # tsx src/index.ts  (hot dev)
# or
npm run build && npm start
```

Minimum local `.env`:

```bash
SAP_URL=https://your-abap-system.example.com
SAP_USERNAME=ABAP_USER
SAP_PASSWORD=secret
SAP_CLIENT=100
SAP_I18N_SERVICE_PATH=/sap/bc/http/sap/zi18n_service
MCP_TRANSPORT=http-streamable      # or "stdio"
PORT=8080
```

By default the server starts an HTTP-streamable MCP endpoint on `http://localhost:8080/mcp` with a `/health` probe.

**Connect an MCP client over HTTP** (Claude web/desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "lisa": { "url": "http://localhost:8080/mcp" }
  }
}
```

**Or over stdio** (local-only, no auth) — set `MCP_TRANSPORT=stdio` and launch the built server directly:

```json
{
  "mcpServers": {
    "lisa": {
      "command": "node",
      "args": ["/absolute/path/to/LISA/dist/index.js"],
      "env": { "MCP_TRANSPORT": "stdio", "SAP_URL": "…", "SAP_USERNAME": "…", "SAP_PASSWORD": "…" }
    }
  }
}
```

> ⚠️ Local mode has **no XSUAA in front of it** — with no auth vars set the HTTP transport is open, and SAP calls use a single technical user instead of per-user principal propagation. Keep it on your machine; don't expose it. For anything shared or production-grade, use **BTP (Part 2)**.

---

## Configuration reference

| Variable | Purpose |
|----------|---------|
| `SAP_I18N_SERVICE_PATH` | URL path of the `ZCL_I18N_SERVICE` HTTP service (default `/sap/bc/http/sap/zi18n_service`). |
| `SAP_URL` / `SAP_USERNAME` / `SAP_PASSWORD` / `SAP_CLIENT` | Direct connection for **local dev**. |
| `SAP_BTP_DESTINATION` | BasicAuth Destination — system-level calls / fallback (BTP). |
| `SAP_BTP_PP_DESTINATION` | PrincipalPropagation Destination — per-user calls (BTP). |
| `MCP_TRANSPORT` | `http-streamable` (default) or `stdio`. |
| `PORT` | HTTP port (default `8080`). |
| `LOG_LEVEL` / `LOG_FORMAT` | `debug\|info\|warn\|error` / `text\|json`. |
| `SAP_API_KEYS` | `key:profile,…` CSV API-key auth (`viewer\|developer\|admin`). |
| `OIDC_ISSUER` / `OIDC_AUDIENCE` | OIDC/Entra ID token validation. |
| `VCAP_SERVICES` | Injected by BTP; carries the XSUAA binding. |
| `LISA_DCR_SIGNING_SECRET` | Stable signing secret for the OAuth DCR store (set via `cf set-env`). |
| `SAP_OAUTH_DCR_TTL_SECONDS` | DCR registration TTL (`0` = never expire). |
| `MCP_RATE_LIMIT` / `OAUTH_RATE_LIMIT` | Per-minute rate limits (default 600 / 20). |
| `CORS_ORIGINS` | Comma-separated allowed CORS origins. |

Full `.env.example` is in the repo.

---

## Documentation

The [`docs_page/`](./docs_page) folder holds the long-form guides:

| Guide | |
|-------|--|
| [Index](./docs_page/index.md) | Documentation home. |
| [Quickstart](./docs_page/quickstart.md) | Fastest path to a working setup. |
| [ABAP service setup](./docs_page/abap-service-setup.md) | Import the class & publish the HTTP service. |
| [MCP tools usage](./docs_page/mcp-usage.md) | Every tool, with examples. |
| [Configuration reference](./docs_page/configuration-reference.md) | All env vars in detail. |
| [Authentication](./docs_page/authentication.md) | Auth model & options. |
| [BTP deployment](./docs_page/btp-deployment.md) | Cloud Foundry / MTA. |
| [Local development](./docs_page/local-development.md) | Dev loop, lint, build. |
| [Architecture](./docs_page/architecture.md) | How the pieces fit together. |

---

## Project structure

```
LISA/
├── abap/                 # ⬅ ABAP objects to import into your SAP system
│   ├── zif_vsp_service.intf.abap
│   ├── zcl_vsp_utils.clas.abap
│   └── zcl_i18n_service.clas.abap
├── docs_page/            # long-form documentation
├── src/
│   ├── index.ts          # entry point
│   ├── handlers/         # MCP tool defs (tools.ts) + registration (intent.ts)
│   ├── sap/              # i18n-client.ts (HTTP to ABAP) + btp.ts (destinations)
│   └── server/           # transport, config, XSUAA OAuth proxy, logging
├── mta.yaml              # BTP MTA descriptor
├── xs-security.json      # XSUAA config (authentication only)
└── .env.example
```

---

## Credits

Architecture, auth proxy and BTP connectivity patterns are modeled on **[ARC-1](https://github.com/marianfoo/arc-1)** by [marianfoo](https://github.com/marianfoo). The translation service itself is built on SAP's **XCO i18n** generation APIs.

## License

[MIT](./LICENSE) © 2026 Clément Ringot.

Portions (the XSUAA OAuth proxy, stateless DCR store, OAuth state codec and BTP
connectivity layer) are derived from **[ARC-1](https://github.com/marianfoo/arc-1)**
and used under its MIT License — see the [`LICENSE`](./LICENSE) file for the
preserved upstream copyright.
