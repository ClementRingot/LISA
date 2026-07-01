# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **OIDC audience validation is now mandatory.** When `OIDC_ISSUER` is set, `OIDC_AUDIENCE` must
  also be set or the server **refuses to start** (it previously warned and accepted any audience).
  Without an audience check the verifier accepts any token signed by the issuer — including one
  minted for a different app on a **shared issuer** (e.g. another Entra application in the same
  tenant), a token-confusion / confused-deputy risk ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)).
  The prior permissive behavior is still reachable, but only via the new explicit
  `OIDC_ALLOW_ANY_AUDIENCE=true` opt-out (logged loudly at every start). Covered by new
  `config.test.ts` cases. **Action:** OIDC deployments without `OIDC_AUDIENCE` must add it (or the
  opt-out) before upgrading.

## [0.8.4] — 2026-06-30

### Fixed
- **`cds_entity` is now advertised in the tool descriptions automatically.** `supportedTargetTypesNote()`
  injects the synthetic `cds_entity` target into an action's advertised `target_type` list whenever both
  physical owners (`data_definition` + `metadata_extension`) are in the handler's allow-list for that
  action. Previously the backend allow-list never mentioned `cds_entity` (it's a LISA-only virtual target
  the MCP fans out before reaching SAP), so an agent could wrongly conclude it was unsupported. This is
  read/write-symmetric and works on any handler without each ABAP variant hardcoding the virtual type.

## [0.8.3] — 2026-06-30

### Added
- **`SAP_BTP_PP_DESTINATION` alone is now a valid startup configuration.** For a pure
  principal-propagation backend (S/4HANA Public Cloud, or the same-subaccount BTP ABAP path) the
  technical `SAP_BTP_DESTINATION` is no longer required — `resolveConfig()` accepts
  `SAP_BTP_DESTINATION` *or* `SAP_BTP_PP_DESTINATION` *or* `SAP_URL`, and the BTP transport enters the
  per-user branch on either destination. Non-JWT (stdio / API-key / system-level) calls still need
  `SAP_BTP_DESTINATION` and now fail with an explicit message when it's absent. Matches ARC-1, which
  needs only its PP destination for this case. Covered by a new `config.test.ts` case.

### Changed
- **CLOUD ABAP handler renamed `ZCL_I18N_SERVICE_CLOUD` → `ZCL_I18N_SERVICE`.** All three platform
  variants now share the class name `ZCL_I18N_SERVICE` and are separated **by folder** only
  (`abap/ABAP_PLATFORM_2022/`, `abap/ABAP_PLATFORM_2025/`, `abap/CLOUD/`). Renamed the `abap/CLOUD/`
  source files to match and updated all docs.
- **BTP ABAP Environment docs: added the same-subaccount `OAuth2UserTokenExchange` path** as the
  recommended option (XSUAA→XSUAA, no Communication Arrangement / SAML trust / OAuth client
  registration — values come from the ABAP service key `uaa` section), with
  `OAuth2SAMLBearerAssertion` reframed as the different-subaccount / advanced case. Fixed the
  token-endpoint guidance (XSUAA `uaa.url/oauth/token` for UserTokenExchange/ClientCredentials vs.
  the ABAP host only for SAML-bearer) and documented instance-level destination `init_data`.
- **S/4HANA Cloud Public Edition docs:** stated SAMLAssertion principal propagation is the only
  supported developer path, added the SAML trust setup steps, BAS destination reuse, the full
  destination property set (default JDK truststore, BAS hint properties), and a
  verification/troubleshooting block.
- **Clarified ABAP Cloud service exposure:** on ABAP Environment the `zi18n_service` HTTP endpoint
  activates automatically when the HTTP Service object is activated — **no communication
  scenario/arrangement** is needed (corrected across the ABAP setup docs).
- **`mta.yaml`: `lisa-logs` and `lisa-connectivity` now ship `active: false` by default.** Application
  Logging hard-fails deploys where SAP retired the service (Note 3557260; LISA logs to stderr
  regardless), and Connectivity is only needed for the on-premise Cloud Connector path (the
  on-premise template re-activates it).
- **DCR:** documented `SAP_OAUTH_DCR_TTL_SECONDS=0` for clients that don't auto-re-register
  (Eclipse Copilot, Cursor), matching ARC-1's `ARC1_OAUTH_DCR_TTL_SECONDS=0` guidance.

## [0.8.2] — 2026-06-27

### Added
- **S/4HANA Public Cloud per-user auth (SAMLAssertion).** When `SAP_BTP_PP_DESTINATION` points at a
  `SAMLAssertion` / `ProxyType=Internet` destination, the BTP transport now detects the
  `samlAssertionAuthorization` token from the Destination Service and forwards it as
  `Authorization: SAML2.0 …` with `x-sap-security-session: create`, routing directly over the internet
  (no Cloud Connector). Reuses the existing PP env var — no new configuration. Mirrors ARC-1
  (arc-mcp/arc-1#524). Requires `@arc-mcp/xsuaa-auth` ≥ 0.1.4.

- **Per-landscape `.mtaext` templates per backend.** Added `mta-overrides-onpremise`,
  `mta-overrides-btp-abap` and `mta-overrides-public-cloud` `.mtaext.example` files, plus a backend
  matrix in `btp-deployment.md`. The SAP BTP ABAP Environment (Steampunk, `OAuth2SAMLBearerAssertion`
  → Bearer token) was already supported by the existing `bearerToken` path — now documented.

### Changed
- Bumped `@arc-mcp/xsuaa-auth` to `^0.1.4`.

## [0.8.1] — 2026-06-26

### Added
- **`text_table` target_type.** Translate text tables (delivery-class C/S DB tables with one LANG key
  field, e.g. `T005T`) through the existing three tools. Adds two params: `language_key_field_name`
  (the LANG key field, e.g. `SPRAS`) and `master_key_fields` (`[{ name, value }]` pinning one record).
  Each `texts` entry's `attribute` is a text **column** name (e.g. `LANDX`). Served on all three stacks
  and advertised via `capabilities`. See [`docs_page/text-table.md`](./docs_page/text-table.md).

### Changed
- **ABAP handler split into per-platform folders.** `abap/ABAP_PLATFORM_2022/` and
  `abap/ABAP_PLATFORM_2025/` (both `ZCL_I18N_SERVICE`, on-premise / private cloud) and `abap/CLOUD/`
  (`ZCL_I18N_SERVICE_CLOUD`, BTP ABAP Environment) — pick the folder for your platform. Same wire
  contract; they differ only in the XCO i18n API surface available on each release.
- **`cds_entity` description scoped to one entity.** Clarified that `cds_entity` covers the **named
  entity and its own DDLX only** and does **not** reach the underlying/parent views of an
  `as projection on` chain (e.g. the `ZI_` interface view behind a `ZC_` projection) — a RAP stack
  needs one `cds_entity` pass per distinct entity. No behavior change.

### Removed
- **Dead `get_translation` / `compare_translations` actions.** The ABAP handler no longer exposes them
  (the MCP surface stopped using them — `list_texts` is the whole-object reader); their mentions are
  dropped from the wire contract and docs.

## [0.8.0] — 2026-06-25

### Added
- **Merged CDS entity translation surface (`cds_entity`).** A new **virtual, LISA-only** `target_type`
  (not a backend type) that treats a CDS view and its metadata extension (DDLX) as **one** translation
  surface, fanned out to the two real targets.
  - **Read.** `TranslateGetTexts` with `target_type: "cds_entity"` issues both backend reads
    (`data_definition` **and** `metadata_extension`), concatenates them (view first), and returns each
    row carrying the **`owner`** the ABAP backend stamps (`"data_definition"` / `"metadata_extension"`)
    — read from the row, never derived; defaulted from the producing call only if a row lacks it. DDLX
    labels are included automatically (no second call). Rows are **not** deduplicated across owners.
    Positional UI labels stay as the **bare** attribute plus a separate `position` (1-based) — never
    bracketed. If one sub-read fails, the successful rows are still returned with the failure attached
    under `errors` (partial success).
  - **Write.** `TranslateSetTexts` with `target_type: "cds_entity"` **groups rows by `owner`** and
    writes each group to its physical object in one backend call (each locked/transported once). Every
    row **must** carry `owner` — a write with any row missing it is **rejected** (LISA never guesses).
    Entity-level texts go out with an empty `field_name` (fixes the `ENDUSERTEXT.LABEL` error from an
    inherited field_name). Writes are **not atomic** across the two objects: the result reports
    per-owner `{ written, success, error? }`, and a partial write returns `success: false`.
  - The single-object `data_definition` / `metadata_extension` (and all non-CDS) targets are
    **unchanged** — one 1:1 backend call. Shared in `@lisa/core`, so the standalone MCP server and the
    ARC-1 extension behave identically. Includes the coupled ABAP backend change (classic + cloud) that
    stamps `owner` on every CDS `list_texts` row.

## [0.7.1] — 2026-06-23

### Fixed
- **Docs: ARC-1 extension marked as shipped.** The roadmap index (`roadmap/README.md`) and the
  `arc1-extension.md` banner/title still said "Planned" / "waiting for v2", and the main README's
  roadmap row said "Shipped" without a version. All now read **✅ Shipped in v0.7.0**, matching the
  released `packages/arc1-extension`.

## [0.7.0] — 2026-06-22

### Added
- **LISA as an ARC-1 extension** — a second distribution (`lisa-arc1-extension`) packages the
  same three tools as in-process ARC-1 plugins (`Custom_TranslateListLanguages`,
  `Custom_TranslateGetTexts`, `Custom_TranslateSetTexts`) loaded via `ARC1_PLUGINS`. It reuses
  the host ARC-1's authenticated SAP client, safety ceiling, scope policy, audit, and per-user
  principal propagation — no second auth stack and no second URL. The standalone server and the
  extension share one wire contract (`@lisa/core`) and one ABAP handler. See
  [docs: ARC-1 extension deployment](./docs_page/arc1-extension-deployment.md).
- Startup warning when `LISA_DCR_SIGNING_SECRET` is set but no XSUAA binding is present — the
  secret is only consumed by the XSUAA OAuth proxy, so this surfaces a dead-config misconfig
  instead of ignoring it silently (parity with ARC-1's set-but-unused signing-secret warn).
- Reproducible release tooling: `npm run release <version>` (`scripts/release.sh`) bumps the
  synced version fields, rolls the CHANGELOG, build/lint/tests, and stages a commit + annotated
  tag; a version-sync guard (`scripts/check-version-sync.mjs`, wired into CI as `check:version`)
  fails the build if the product version or the extension version drifts across the files that
  carry it. Documented in [docs: releasing](./docs_page/releasing.md).
- Dependabot for the npm workspaces, the Docker base image, and the GitHub Actions, with grouped
  weekly PRs (`arc-1`/`@arc-mcp/*` kept in their own group).

### Changed
- **Restructured into an npm-workspaces monorepo**: `@lisa/core` (the transport-agnostic wire
  contract + Zod schemas shared by both consumers), `packages/server` (the existing standalone
  BTP server, now consuming `@lisa/core` and bundled with esbuild so the deploy artifact carries
  no workspace symlinks), and `packages/arc1-extension`. No behavior change to the standalone
  server; the deployable surface and the 3 tools are unchanged.
- README now presents the **standalone server** and the **ARC-1 extension** as two first-class
  deployment paths (Part 2 / Part 3) instead of mentioning the extension only in passing.
- arc-1 extension: pin the `arc-1` dependency to `>=0.9.20` — the version that ships the gated
  `ctx.http.post` (raw write surface) the extension's transport calls (dev floor `^0.9.20`, peer
  floor `>=0.9.20`, so an older host is flagged rather than failing at runtime on a missing `post`).
- DCR client_id prefix changed `sapt-` → `lisa-` (the prior prefix was an undocumented
  acronym; `lisa-` is self-documenting and traceable in XSUAA/logs). Changing the prefix
  re-issues DCR client_ids: already-registered MCP clients re-register automatically on
  their next sign-in — one-time, transparent, no migration needed since the DCR store is
  stateless/HMAC.
- Bumped `zod` to v4 across all packages (arc-1 peer-depends on `zod` ^4; the MCP SDK supports
  both 3.25+ and 4 — usage was already a compatible subset).
- Docs: aligned the `LISA_DCR_SIGNING_SECRET` generation command across README / BTP deployment /
  mtaext template on `openssl rand -base64 48` (the value `@arc-mcp/xsuaa-auth` recommends).

## [0.6.2] — 2026-06-22

### Changed
- Docs: `mta-overrides.mtaext.example` now documents `SAP_OAUTH_DCR_TTL_SECONDS` (set `0` so DCR
  registrations never expire) and spells out that `LISA_DCR_SIGNING_SECRET` must be pinned
  out-of-band via `cf set-env` — left unset it falls back to the XSUAA `clientsecret`, which
  `cf deploy` rotates on every deploy, invalidating cached client registrations.

## [0.6.1] — 2026-06-22

### Changed
- Adopted `@arc-mcp/xsuaa-auth` `0.1.3`; refreshed the XCO i18n requirements wording in the docs.

## [0.6.0] — 2026-06-18

### Added
- Tool descriptions for `TranslateGetTexts`/`TranslateSetTexts` now advertise the
  **concrete `target_type` list THIS system accepts**, probed once from the ABAP backend's
  `capabilities` action at tool registration (process-cached) instead of stating the generic
  catalog. Falls back to the stack-differences caveat when the probe is unavailable (older
  handler / SAP unreachable); the runtime reject on an unsupported type stays as the backstop.

### Fixed
- ABAP: 2-character ISO language codes were truncated to their first character before being
  passed to XCO (`RO` → `R` = Russian, `ES` → `E` = English) — any language whose ISO initial
  didn't match its 1-char SAP code (`SPRAS`) was silently translated to the wrong language or
  rejected. Added a proper ISO→SPRAS resolution (`I_Language.LanguageISOCode`) used everywhere
  a language is passed to XCO. **Requires re-importing the ABAP handler class(es).**

## [0.5.1] — 2026-06-18

### Changed
- Docs: capabilities can also differ between on-premise/private-cloud systems by **system
  version**, not just by stack (public cloud vs on-prem) — tool description and docs updated
  accordingly; dropped speculative future-release-class wording.

## [0.5.0] — 2026-06-18

### Added
- **Per-stack capability guard**: public cloud / BTP ABAP Environment and on-premise / private
  cloud support different translatable object types. Each ABAP handler now declares an
  allow-list per action via a new `capabilities` action (`{ list_texts: […], set_translation:
  […] }`); the MCP server probes it once (cached) and rejects an unsupported `target_type`
  up-front with a clear message, instead of surfacing a raw ABAP error after the call. Older
  handlers without the `capabilities` action degrade gracefully to permissive (the
  `CLOUD_UNSUPPORTED` backstop still fires).

## [0.4.0] — 2026-06-18

### Changed
- **Adopted the shared `@arc-mcp/xsuaa-auth` package**, retiring LISA's in-tree XSUAA OAuth +
  DCR + OAuth-state + BTP modules (net ~2100 LOC removed). Preserves all existing behavior:
  LISA's redirect-uri allowlist, `api-key:<profile>` identity, optional OIDC audience,
  authenticate-only (no scope enforcement), and the 3-tool surface. Auth + BTP connectivity is
  now a dependency instead of vendored code.
- Bumped Express 4 → 5 and the MCP SDK floor to `^1.18.2` (peer requirements of
  `@arc-mcp/xsuaa-auth`).

## [0.3.1] — 2026-06-18

### Added
- `roadmap/` — forward-looking design docs (not implemented): distributing LISA as an
  ARC-1 extension once the extension framework reaches v2, and sharing the XSUAA/BTP auth
  layer via the published `@arc-mcp/xsuaa-auth` package.

### Changed
- Docs: clarify that the service is exposed via `UCON_HTTP_SERVICES` on **on-premise /
  private cloud** and via a **communication scenario** on BTP ABAP Environment / public cloud
  (the prerequisites previously implied `UCON_HTTP_SERVICES` for all stacks).
- Docs: refresh ARC-1 upstream references to the `arc-mcp` org (repo, `docs.arc-1-mcp.com`,
  `ghcr.io/arc-mcp/arc-1`).

## [0.3.0] — 2026-06-16

### Added
- `TranslateSetTexts` accepts **per-entry selectors**: each `texts` item may carry its own
  `field_name`/`position` (overriding the top-level ones). All fields of one
  `data_definition`/`metadata_extension` (e.g. every `ui_lineitem_label` across fields) can
  now be written in a **single call**; the ABAP handler groups entries by field and writes
  each under one transport change scenario, so the object is enqueued/locked only once
  instead of once per field — avoiding the lock collisions seen when writing field-by-field.
- `TranslateGetTexts` now surfaces the `populated` flag the ABAP emits per text slot
  (`false` = the slot exists but is empty in the requested language, i.e. still to
  translate), and decomposes positional metadata-extension attributes (`ui_facet_label[1]`)
  into a base `attribute` + a `position`, so `(field_name, position, attribute)` round-trips
  into `TranslateSetTexts`.
- `LICENSE` (MIT) with the project copyright and preserved upstream attribution
  for the ARC-1-derived modules; `license` field in `package.json`.

### Changed
- **Tool surface reduced from 5 to 3** (`TranslateListLanguages`, `TranslateGetTexts`,
  `TranslateSetTexts`). `TranslateGetTexts` is now the whole-object reader (backed by the
  `list_texts` action) with an **optional** `language` — when omitted, the object is read in
  its original language and the effective language is returned.

### Removed
- `TranslateListTexts` and `TranslateCompare`. Listing is `TranslateGetTexts` filtered on
  `populated`; comparing is two `TranslateGetTexts` calls diffed on `(key, populated, value)`.

## [0.2.0] — 2026-06-11

### Added
- Unit test suite (Vitest) covering the security-critical pure modules: OAuth
  state codec, stateless DCR client store, redirect-URI allowlist/validation,
  tool input schemas, config parsing, and the chained token verifier (API-key path).
- `npm test` / `npm run test:watch` scripts and `vitest.config.ts`.
- Continuous integration workflow (lint + test + build) on pushes and PRs.
- ABAP service sources (`abap/`) and long-form docs (`docs_page/`).

### Changed
- API-key authentication now uses a constant-time comparison (hash + `timingSafeEqual`)
  instead of `===`, removing a timing side channel on the configured keys.
- OIDC verifier now logs a warning when `OIDC_AUDIENCE` is unset (audience is then
  not validated), making the weaker configuration explicit.
- Centralised the server version in `src/server/version.ts` (was duplicated).
- Tool descriptions are now sourced from the `TOOLS` registry, removing drift
  between `intent.ts` and `tools.ts`.
- Corrected stale doc comments ("3-scope model", "ARC-1") to match the
  authentication-only design.
- Fixed pre-existing lint violations so `npm run lint` passes clean.

## [0.1.0] — 2026-06-09

### Added
- Initial SAP Translation MCP server: 5 tools (`TranslateListLanguages`,
  `TranslateListTexts`, `TranslateGetTexts`, `TranslateSetTexts`, `TranslateCompare`)
  over the `ZCL_I18N_SERVICE` ABAP HTTP service.
- XSUAA OAuth proxy (stateless DCR + signed callback state), OIDC and API-key auth.
- BTP deployment (MTA), Destination + Connectivity (principal propagation).

[Unreleased]: https://github.com/ClementRingot/LISA/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ClementRingot/LISA/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/ClementRingot/LISA/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/ClementRingot/LISA/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/ClementRingot/LISA/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/ClementRingot/LISA/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ClementRingot/LISA/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ClementRingot/LISA/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ClementRingot/LISA/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ClementRingot/LISA/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ClementRingot/LISA/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ClementRingot/LISA/releases/tag/v0.1.0
