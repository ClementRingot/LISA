# Distribute LISA as an ARC-1 extension

> **Status: ✅ shipped in v0.7.0.** `packages/arc1-extension` (`lisa-arc1-extension`) ships the `Custom_*`
> tools described below, on top of the monorepo topology recommended in this doc (`@lisa/core` +
> `packages/server` + `packages/arc1-extension`, npm workspaces instead of Changesets). The tools
> reach SAP through ARC-1's gated `ctx.http.post` (raw non-ADT write surface). For the deployment
> runbook see **[docs: ARC-1 extension deployment](../docs_page/arc1-extension-deployment.md)**.

## Goal

When the ARC-1 extension framework (FEAT-61) reaches v2, repackage LISA's three tools as
`Custom_*` tools loaded **in-process** by an ARC-1 instance. Such tools reuse ARC-1's
authenticated SAP client, its safety ceiling, scope policy, audit, and **per-user principal
propagation** — no second auth stack, no second deployment.

Reference: [ARC-1 — Extensions (Custom Tools)](https://docs.arc-1-mcp.com/extensions/).

LISA already maps onto ARC-1's "Extension" decision: it talks to the **same SAP system over
HTTP** via a **custom ICF/REST service** (`/sap/bc/http/sap/zi18n_service`). Extensions never
ship ABAP — and LISA's `ZCL_I18N_SERVICE(_CLOUD)` is deployed separately to SAP anyway, so that
constraint is already satisfied.

## Why this waits for v2

Three concrete blockers make v1 a poor fit:

1. **`ctx.http` is GET/HEAD only in v1.** LISA's wire contract is **POST + JSON body for every
   action, including reads** — the ABAP handler reads the action from `~path_info` and parses
   parameters from the request body. So even `TranslateGetTexts` / `TranslateListLanguages`
   cannot be expressed as `ctx.http.get()` without first reworking the ABAP handler to accept a
   **real GET with query-string params** (no body — a GET body is rejected by undici and has no
   defined semantics per RFC 9110).
2. **`TranslateSetTexts` is a write** (it modifies translations and requires a transport).
   General write / `POST` support is deferred to v2.
3. **`ctx.run.classRun` does not help.** It targets `IF_OO_ADT_CLASSRUN` console classes that
   return text output — not an `IF_HTTP_SERVICE_EXTENSION` handler returning JSON.

What v2 is expected to bring (track the backlog in
[arc-1#458](https://github.com/arc-mcp/arc-1/pull/458)):

- a **`ctx.write`** vocabulary, and in particular **opt-in raw writes for package-less
  OData/ICF calls** — exactly LISA's case (writes go through a custom ICF endpoint that has no
  package, so the `SAP_ALLOWED_PACKAGES` gate doesn't apply);
- the API graduating from `@experimental` to **semver-stable**;
- plugin loading from an **npm package** (not only an absolute file path).

## Tool mapping (LISA → `Custom_*`)

The `Custom_` prefix is mandatory (reserved namespace). All three are **code-tier** tools
(`defineTool`, TypeScript handler) rather than manifest-tier, because they need response
shaping — notably the `field_name`/`position` decomposition, the `populated` flag, and the
local diffing that `TranslateGetTexts` performs.

| Today (standalone) | As extension | `scope` | Notes |
|--------------------|--------------|---------|-------|
| `TranslateListLanguages` | `Custom_TranslateListLanguages` | `read` | No parameters. |
| `TranslateGetTexts` | `Custom_TranslateGetTexts` | `read` | Reader/diff tool; the original-language + per-language reads. |
| `TranslateSetTexts` | `Custom_TranslateSetTexts` | `write` | Requires `SAP_ALLOW_WRITES=true` on the ARC-1 deployment; the `transport` is still passed through to the ICF service. |

Reads still need POST-to-ICF semantics, so they ride v2's raw-ICF surface **or** require the
ABAP handler to expose the read actions over GET (query-string params). Pick one when v2 lands.

## Repository topology — keeping standalone and extension in sync

The two distributions differ in exactly **one thing**: who performs the HTTP call to
`/sap/bc/http/sap/zi18n_service/{action}`. Everything else — wire-contract types, Zod schemas,
tool descriptions, the `field_name`/`position` decomposition, the `populated` flag, local
diffing — is identical. So the prerequisite for "change once, both follow" is a
**transport-agnostic core** with a small injected port:

```ts
// @lisa/core — no SAP/BTP/MCP/arc-1 dependency
export interface I18nTransport {
  call<T>(action: 'list_languages' | 'list_texts' | 'set_translation',
          params: Record<string, unknown>): Promise<T>;
}
export function buildTools(t: I18nTransport) { /* the 3 tools — shared logic */ }
```

```
                 ┌───────────────────────────────┐
                 │  @lisa/core                    │
                 │  types · Zod schemas · tool    │
                 │  descriptions · shaping/diff   │
                 │  I18nTransport (port)          │
                 └───────────────┬───────────────┘
                  depends on     │     depends on
        ┌────────────────────────┴────────────────────────┐
        ▼                                                  ▼
┌───────────────────────────┐            ┌──────────────────────────────────┐
│ standalone server         │            │ arc-1 extension                  │
│ transport = undici + BTP  │            │ transport = ctx.http / ctx.write │
│ + PP; MCP/Express + XSUAA │            │ wrapped in defineTool            │
└───────────────────────────┘            └──────────────────────────────────┘
```

With that seam in place, pick one of two topologies:

| Topology | How | Best when |
|----------|-----|-----------|
| **Monorepo (workspaces)** | one repo, packages `@lisa/core` + `@lisa/server` + `@lisa/arc1-extension`; independent versions via **Changesets** | solo maintainer who wants both to move together — one PR changes core + both adapters atomically, one CI, no publish step to propagate |
| **Two repos + published `@lisa/core`** | core published to npm; each repo depends on it (release-please / Changesets to bump) | strict separation; mirrors ARC-1's own `@arc-mcp/xsuaa-auth` extraction. Cost: a publish → bump → consume cycle and possible version skew |

> A git submodule/subtree sharing `core/` is a third option but is more pain than value for a
> solo maintainer — avoid.

Either way, keep the extension itself a **separate package**, following ARC-1's own
[`arc-mcp/arc-1-extension-sample`](https://github.com/arc-mcp/arc-1-extension-sample) pattern — its
`arc-1/public` peer dependency and its `@experimental` + `apiVersion` coupling must not leak into
the standalone server (plugins ship as **local files** loaded via `ARC1_PLUGINS`, so the built
artifact is what ships). And keep two invariants:

- **Contract tests live in `@lisa/core`** — exercise the 3 tools once against a mock transport
  (in the spirit of `createMockToolContext`; LISA already has `tools.test.ts` / `i18n-client.test.ts`).
  They guard both adapters against drift.
- **One canonical ABAP source.** `ZCL_I18N_SERVICE(_CLOUD)` lives in a single place, next to the
  core — the `@lisa/core` wire types *are* the contract with that class, so ABAP and types
  version together. The extension references it; it never duplicates it.

**Recommendation:** for a solo maintainer who wants them to evolve together, start with the
**monorepo + Changesets** (core + two adapters). The `I18nTransport` seam is identical in both
topologies, so you can publish `@lisa/core` later — if a third consumer appears — without
rewriting anything.

## Integration & deployment ("do I deploy it separately?")

> For the step-by-step ops guide (build, `ARC1_PLUGINS`, the write flags, Docker/buildpack, verify,
> troubleshooting) see **[docs: ARC-1 extension deployment](../docs_page/arc1-extension-deployment.md)**.
> The summary below is the rationale.

**No — an extension is not a separate deployment.** No second Cloud Foundry app, no second URL,
no second XSUAA. It's a file loaded **in-process** by ARC-1 at startup via `ARC1_PLUGINS`
(a CSV of **absolute** paths). Operationally you go from **two CF apps** (arc1 + lisa) to
**one** (arc1 with the plugin baked in).

Two strategies on BTP Cloud Foundry:

**Derived Docker image** (recommended by ARC-1):

```dockerfile
FROM ghcr.io/arc-mcp/arc-1:latest
COPY --chown=arc1:arc1 dist/      /home/arc1/plugins/lisa/dist/
COPY --chown=arc1:arc1 manifests/ /home/arc1/plugins/lisa/manifests/
ENV ARC1_PLUGINS=/home/arc1/plugins/lisa/dist/index.js
```

then `cf push arc1 --docker-image <registry>/my-arc1:<tag>`. Self-contained and version-pinned
with ARC-1.

**Buildpack co-deploy**: put the built `dist/` in the pushed app bits (e.g. `plugins/lisa/`) and
set `ARC1_PLUGINS=/home/vcap/app/plugins/lisa/dist/index.js`. Plain `mta build` / `cf push`; the
bits are `vcap`-owned, so the owner check below is a non-issue.

Gotchas:

- **`COPY --chown=arc1:arc1` is mandatory on Docker.** The loader refuses a plugin file owned by
  `root` or world-writable; a plain `COPY` lands files as root and is rejected.
- **No hot-reload.** Changing the plugin means rebuild + `cf restage` of ARC-1.
- **No XSUAA change.** Plugin tools reuse the 7 built-in scopes, so you don't touch
  `xs-security.json` or role collections to ship a new `Custom_*` tool.
- **Write flags are server env.** `SAP_ALLOW_WRITES` (and any execute opt-in) are set on the
  ARC-1 deployment (`cf set-env` / MTA), only where you intend writes to run.
- **The ABAP service still deploys separately** to SAP, extension or not.

## Checklist to revisit when v2 ships

- [ ] Confirm the shape of `ctx.write` / the package-less raw-ICF write surface.
- [ ] Decide reads: GET-with-query-string (rework the ABAP handler) vs v2 raw POST.
- [ ] Name and scaffold the separate extension repo.
- [ ] Confirm the standalone LISA server stays maintained in parallel.

## References

- ARC-1 Extensions: https://docs.arc-1-mcp.com/extensions/
- Extension sample repo: https://github.com/arc-mcp/arc-1-extension-sample
- v2 backlog (risk × value triage): https://github.com/arc-mcp/arc-1/pull/458
