# Deploying LISA as an ARC-1 extension

LISA ships in **two distributions** from the same monorepo, sharing one wire contract
(`@lisa/core`) and one ABAP handler:

- the **standalone MCP server** (`packages/server`) — its own Cloud Foundry app, its own XSUAA.
  See **[BTP deployment](./btp-deployment.md)**.
- the **ARC-1 extension** (`packages/arc1-extension`, `lisa-arc1-extension`) — the same three
  tools loaded **in-process** by an existing ARC-1 instance via `ARC1_PLUGINS`. **This page.**

> **Status.** The extension is implemented (`Custom_TranslateListLanguages`,
> `Custom_TranslateGetTexts`, `Custom_TranslateSetTexts`). It needs an `arc-1` build that exposes
> gated `ctx.http.post` — [arc-mcp/arc-1#474](https://github.com/arc-mcp/arc-1/pull/474), **merged
> on `main` but not yet in a published npm release** (`arc-1@0.9.19` is GET/HEAD-only). Until that
> release lands, the extension type-checks and tests against the installed package via a single
> documented cast (`packages/arc1-extension/src/transport.ts`), but a deployed ARC-1 running
> `0.9.19` will reject the tools' POSTs at runtime. Deploy it against an ARC-1 built from a commit
> that contains #474.

## Standalone vs extension — which one?

| Pick the… | when |
|-----------|------|
| **Standalone server** | You want LISA reachable as its own MCP endpoint/URL, with its own XSUAA login, independent of any ARC-1 deployment. One more CF app to operate. |
| **ARC-1 extension** | You already run ARC-1 and want LISA's tools to appear **inside** it — reusing ARC-1's authenticated SAP client, safety ceiling, scope policy, audit, and **per-user principal propagation**. No second auth stack, no second URL: you go from two CF apps (arc1 + lisa) to **one**. |

Both talk to the **same** `ZCL_I18N_SERVICE(_CLOUD)` handler over the same wire contract — the only
difference is who performs the HTTP call. The ABAP service is deployed to SAP **separately** either
way (see [ABAP service setup](./abap-service-setup.md)).

## Prerequisites

- An **ARC-1 instance** you control, built from a revision that includes #474 (gated `ctx.http.post`).
- The **ABAP service installed** on the target SAP system ([ABAP service setup](./abap-service-setup.md)).
  ARC-1's own SAP connection (destination / Cloud Connector) must reach it.
- Node 22 + this repo, to build the plugin bundle.

## 1. Build the extension

```bash
npm ci
npm run build --workspace packages/arc1-extension   # → packages/arc1-extension/dist/index.js
```

`dist/index.js` (plus its `dist/**`) is the artifact ARC-1 loads. `@lisa/core` is compiled to the
same `dist` tree; ship the whole `packages/arc1-extension/dist/` folder.

## 2. Point ARC-1 at the plugin

ARC-1 loads code plugins from `ARC1_PLUGINS` — a CSV of **absolute** paths to each plugin's
`dist/index.js`. The required runtime env on the **ARC-1 side**:

| Env var | Value | Why |
|---------|-------|-----|
| `ARC1_PLUGINS` | `/abs/path/to/lisa/dist/index.js` | Loads the plugin in-process at startup. |
| `SAP_ALLOW_WRITES` | `true` | ARC-1's master write gate. |
| `SAP_ALLOW_PLUGIN_RAW_WRITES` | `true` | Opt-in for **non-ADT (OData/ICF) raw writes** via `ctx.http.post`. |
| `SAP_I18N_SERVICE_PATH` | `/sap/bc/http/sap/zi18n_service` | Optional — only to override the default ICF path. |

> **Why all three tools need the write flags — even the reads.** LISA's wire contract is *POST for
> every action* (the ABAP handler reads the action from `~path_info` and parses params from the JSON
> body). ARC-1's `ctx.http` gates by **HTTP method**, so any `post()` — including
> `Custom_TranslateListLanguages` and `Custom_TranslateGetTexts`, which only read — goes through the
> raw-write gate. That is why every tool declares `scope:'write'` and why
> `SAP_ALLOW_PLUGIN_RAW_WRITES` is mandatory, not just for the writer. The tools' declared `opType`
> stays honest (`Read` for the readers, `Update` for `Custom_TranslateSetTexts`).
>
> LISA's path (`/sap/bc/http/sap/...`) is **non-ADT**, so it passes ARC-1's ADT-path refusal on the
> raw-write surface (`SAP_ALLOWED_PACKAGES` can't be enforced on a raw ICF call; SAP-side auth on
> `ZI18N_SERVICE` is the backstop). A real translation write still lands in the caller-supplied
> `transport`.

## 3. Deploy on BTP Cloud Foundry

An extension is **not** a separate deployment — no second app, URL, or XSUAA. Two strategies:

### A. Derived Docker image (recommended by ARC-1)

```dockerfile
FROM ghcr.io/arc-mcp/arc-1:<tag-with-#474>
COPY --chown=arc1:arc1 packages/arc1-extension/dist/ /home/arc1/plugins/lisa/dist/
ENV ARC1_PLUGINS=/home/arc1/plugins/lisa/dist/index.js
```

```bash
cf push arc1 --docker-image <registry>/my-arc1:<tag>
cf set-env arc1 SAP_ALLOW_WRITES true
cf set-env arc1 SAP_ALLOW_PLUGIN_RAW_WRITES true
cf restage arc1
```

Self-contained and version-pinned with ARC-1.

> **`COPY --chown=arc1:arc1` is mandatory.** ARC-1's plugin loader refuses a plugin file owned by
> `root` or world-writable; a plain `COPY` lands files as root and is rejected.

### B. Buildpack co-deploy

Put the built `dist/` in the pushed app bits (e.g. `plugins/lisa/`) and set
`ARC1_PLUGINS=/home/vcap/app/plugins/lisa/dist/index.js`. Plain `cf push` / MTA; the bits are
`vcap`-owned, so the ownership check above is a non-issue. Set the two `SAP_ALLOW_*` flags the same
way (`cf set-env` or MTA properties).

## 4. Verify

```bash
cf restart arc1
cf logs arc1 --recent | grep -i plugin       # plugin loaded? tools registered?
```

In an MCP client connected to ARC-1, the three `Custom_Translate*` tools should appear in
`tools/list`. Call `Custom_TranslateListLanguages` (no args) as the smoke test.

## Gotchas

- **No hot-reload.** Changing the plugin means rebuild + `cf restage` (Docker) / re-push (buildpack)
  of ARC-1.
- **No XSUAA change.** Plugin tools reuse ARC-1's built-in scopes, so you don't touch
  `xs-security.json` or role collections to ship a new `Custom_*` tool.
- **Write flags are ARC-1 server env**, set only where you intend writes to run.
- **The ABAP service still deploys separately** to SAP, extension or not.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Tools missing from `tools/list` | `ARC1_PLUGINS` path absolute & correct; plugin file owner (`arc1`, not root) on Docker; `cf logs` for a loader rejection. |
| Tool call fails: "Set SAP_ALLOW_PLUGIN_RAW_WRITES=true…" | `SAP_ALLOW_PLUGIN_RAW_WRITES` and/or `SAP_ALLOW_WRITES` not set on ARC-1. |
| Tool call fails: "may not write to an ADT path" | `SAP_I18N_SERVICE_PATH` was pointed at a `/sap/bc/adt/…` path — LISA's ICF service must be non-ADT. |
| `post is not a function` / runtime type error | ARC-1 build predates #474 (GET/HEAD-only `ctx.http`). Rebuild ARC-1 from a revision containing #474. |
| Authenticated but SAP auth errors | Expected — SAP enforces translation authorization; grant the user the rights in SAP. |

## See also

- **[BTP deployment](./btp-deployment.md)** — the standalone-server CF deployment.
- **[roadmap/arc1-extension.md](../roadmap/arc1-extension.md)** — the design rationale, tool mapping,
  and the monorepo topology behind both distributions.
- **[Architecture](./architecture.md)** — how `@lisa/core`, the server, and the extension fit together.
