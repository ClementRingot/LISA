# Architecture

## The big picture

```
┌──────────────┐   MCP/HTTP    ┌──────────────────────────────┐   HTTPS JSON   ┌──────────────────────┐
│ AI assistant │ ────────────▶ │       LISA MCP      │ ─────────────▶ │  SAP ABAP system     │
│ (Claude/IDE) │   3 tools     │  ┌────────────────────────┐   │  POST          │  ┌────────────────┐  │
│              │ ◀──────────── │  │ transport (http/stdio) │   │  {path}/{action}│  │ ZCL_I18N_SERVICE│  │
└──────────────┘               │  │ auth (XSUAA/OIDC/key)  │   │ ◀───────────── │  │  (HTTP handler) │  │
                               │  │ I18nClient (wire)      │   │  {success,data} │  └───────┬────────┘  │
                               │  └────────────────────────┘   │                │          ▼            │
                               └──────────────────────────────┘                │   XCO i18n APIs       │
                                                                                 └──────────────────────┘
```

Two independently deployable halves:

- **ABAP side** — a single, self-contained handler class exposed as an ABAP HTTP service (`IF_HTTP_SERVICE_EXTENSION`, enabled in `UCON_HTTP_SERVICES` on-premise; on ABAP Environment the endpoint activates automatically with the HTTP Service object — no communication scenario). Does the real translation work through the XCO i18n generation APIs. The class is always named **`ZCL_I18N_SERVICE`**; interchangeable variants live in separate folders and share the same wire contract — `abap/ABAP_PLATFORM_2022|2025/` (on-premise / private cloud) and `abap/CLOUD/` (BTP ABAP Environment / public cloud, restricted to released/Cloud-compliant APIs).
- **Node side** — this repo. Authenticates the caller, propagates identity, and maps MCP tool calls to HTTP calls.

## Request lifecycle (BTP, http-streamable)

1. **MCP client → server.** The client calls `/mcp` with a tool invocation and a bearer token.
2. **Authentication.** The chained verifier validates the token (XSUAA → OIDC → API key). On failure → 401. (See [Authentication](./authentication.md).)
3. **Tool dispatch.** `intent.ts` routes the call to one of the 3 tools; Zod (`tools.ts`) validates the arguments.
4. **Connection resolution.** `i18n-client.ts` builds a connection:
   - user JWT + `SAP_BTP_PP_DESTINATION` → per-user **principal propagation** destination;
   - else → BasicAuth technical destination (`SAP_BTP_DESTINATION`);
   - on-premise targets go through the **Connectivity proxy** (standard HTTP forward-proxy, not CONNECT).
5. **HTTP call to SAP.** POST to `{SAP_I18N_SERVICE_PATH}/{action}` with the params as a JSON body.
6. **ABAP handling.** The handler class reads the action from the last path segment, parses the body via its inlined `extract_param` helper, runs the XCO i18n call under the propagated user, and wraps the result in `{success,data}` / `{success,error}`.
7. **Unwrap & return.** The client unwraps the envelope and returns the `data` to the assistant.

## Why a thin ABAP HTTP service (vs. ADT/OData)?

The XCO i18n APIs are ABAP-side generation APIs with no general REST surface. A small purpose-built handler:

- keeps the wire contract tiny and explicit (5 actions, JSON in/out),
- lets the heavy lifting (XCO calls, transport handling) run **inside** SAP under the user's authorizations,
- works over plain HTTP, so the same Cloud Connector / Destination plumbing as ARC-1 applies unchanged.

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Authentication only, no MCP authorization** | SAP already governs translation rights; duplicating them in the MCP would drift. See [Authentication](./authentication.md). |
| **Action in the URL path, params in the body** | Matches `IF_HTTP_SERVICE_EXTENSION` routing (`~path_info`); avoids query-string parsing in ABAP. |
| **Semantic `target_type` literals** | XCO's own object vocabulary (`data_element`, …) rather than DDIC codes — fewer translations between layers. |
| **Wrapped `{success,data}` envelope** | Uniform success/error handling; HTTP 400 on logical errors. |
| **Stateless DCR + signed state** | Lets standard MCP OAuth clients use XSUAA without server-side session storage. |
| **Auth/BTP via `@arc-mcp/xsuaa-auth`** | Depends on ARC-1's extracted, production-proven XSUAA/OAuth + BTP package instead of vendoring that stack. |

## File map

| Concern | File |
|---------|------|
| Wire contract + tool schemas | `packages/core/src/wire.ts`, `packages/core/src/schemas.ts` |
| Tool registration (standalone server) | `packages/server/src/handlers/intent.ts` |
| Tool registration (ARC-1 extension) | `packages/arc1-extension/src/tools/` |
| BTP transport | `packages/server/src/sap/transport.ts` |
| BTP destinations / proxy | `@arc-mcp/xsuaa-auth/btp` (consumed in `packages/server/src/sap/transport.ts`) |
| Config | `packages/server/src/server/config.ts` |
| Transport / OAuth router / callback proxy | `packages/server/src/server/http.ts` |
| XSUAA proxy + verifier, DCR store, OAuth state codec | `@arc-mcp/xsuaa-auth` (wired in `packages/server/src/server/http.ts`) |
| Logger → package adapter | `packages/server/src/server/logger.ts` (`toPackageLogger`) |
| ABAP handler (on-premise / private cloud, ABAP Platform 2022) | `abap/ABAP_PLATFORM_2022/zcl_i18n_service.clas.abap` |
| ABAP handler (on-premise / private cloud, ABAP Platform 2025+) | `abap/ABAP_PLATFORM_2025/zcl_i18n_service.clas.abap` |
| ABAP handler (BTP ABAP Environment / public cloud) | `abap/CLOUD/zcl_i18n_service.clas.abap` |

> **Why three ABAP handler classes, and how to evolve them** — why LISA stays one platform-agnostic MCP, why the `abap/` tree is split per platform, the compilation wall that keeps Cloud and on-premise separate, and how to grow the wire contract additively (with worked examples) without forking the MCP: see [`wire-contract-evolution.md`](./wire-contract-evolution.md).
