# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- DCR client_id prefix changed `sapt-` → `lisa-` (the prior prefix was an undocumented
  acronym; `lisa-` is self-documenting and traceable in XSUAA/logs). Changing the prefix
  re-issues DCR client_ids: already-registered MCP clients re-register automatically on
  their next sign-in — one-time, transparent, no migration needed since the DCR store is
  stateless/HMAC.

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

[Unreleased]: https://github.com/ClementRingot/LISA/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/ClementRingot/LISA/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ClementRingot/LISA/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ClementRingot/LISA/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ClementRingot/LISA/releases/tag/v0.1.0
