# @lisa-mcp/server

## 0.9.5

### Patch Changes

- fb46903: Upgrade `dotenv` from 17 to 18. LISA loads `.env` through `import 'dotenv/config'`, which v18 still supports, and it never used the preloading or `.env.vault` features that v18 removed. One visible change: when a `.env` file is present, dotenv now prints its "injected env" line to stderr instead of stdout. stdout carries the MCP JSON-RPC stream in stdio mode, and it stays clean either way (verified).

## 0.9.4

### Patch Changes

- 01f5805: Upgrade `express-rate-limit` from 7.5 to 8.7. The limiter configuration is unchanged and behaves the same for IPv4 clients. One behaviour change comes from v8's defaults: IPv6 clients are now keyed by their /56 subnet, so addresses in the same subnet share one quota. This hardens the limit against clients that rotate IPv6 addresses.
- d62908c: Upgrade the authentication layer `@arc-mcp/xsuaa-auth` from 0.1.8 to 1.1.0. The 1.0 line is a stabilisation release with no breaking API change; 1.1.0 only adds opt-in features. Transitive runtime updates come with it: `@sap/xssec` 4.15.0, `@sap-cloud-sdk/*` 4.9.1, `undici` 8.11.0, `zod` 4.6.5, `jose` 6.2.12.
- 6e76553: Report the real server version in `/health` and in the MCP `serverInfo`. When the server was not started through an npm script (the Docker image, `node dist/index.js`, `npx @lisa-mcp/server`), both showed a stale hard-coded `0.6.2`. Under `npx` they could also show the calling project's version. The build now bakes the version from the package's own `package.json` into the bundle.

## 0.9.3

### Patch Changes

- 41cc993: Security: patch all 9 npm audit advisories (7 high, 2 moderate) — `undici` 8.7.0 → 8.10.0 (response
  desynchronisation, CRLF injection, cross-user information disclosure), `axios` 1.17.0 → 1.19.0
  (proxy bypass, prototype pollution, DoS), `hono` / `@hono/node-server` (XSS, ReDoS, path traversal
  in serve-static), `ip-address` 10.2.0 → 10.5.0, plus dev-only `fast-uri`, `js-yaml`, `nanoid` and
  `postcss`. Lockfile-only: every advisory was fixable inside the existing semver ranges, so no
  dependency range changed and there is no breaking change. This release rebuilds the published
  artifacts (npm tarball and the ghcr Docker image) against the patched tree. `npm audit` now reports
  0 vulnerabilities.

## 0.9.2

### Patch Changes

- 3906b9f: Docker: the official image is now published to `ghcr.io/clementringot/lisa-mcp` (`X.Y.Z` +
  `latest`) on every product release, and no longer bakes in a wrong
  `SAP_I18N_SERVICE_PATH` (`/sap/bc/rest/zcl_i18n_service` — it silently overrode the code's
  correct `/sap/bc/http/sap/zi18n_service` default, breaking any container run without an explicit
  override) nor a hardcoded `SAP_CLIENT`. Self-hosted usage (Docker/Kubernetes, auth via API keys
  or OIDC) is now documented in the README. npm package content is unchanged.

## 0.9.1

### Patch Changes

- 8541fc9: Fix the deploy-from-npm MTA template and enrich the published tarball. The template's MTA ID is
  now `lisa` (was `lisa-npm`, which silently prevented every `mta-overrides*.mtaext`
  (`extends: lisa`) from applying to npm-based deploys — and made source-build and npm deploys land
  as two separate MTA deployments instead of upgrading one). The tarball now also ships the four
  per-backend landscape override templates (`templates/mta/mta-overrides*.mtaext.example`) and the
  commented `.env.example` for local `npx @lisa-mcp/server` usage.

## 0.9.0

### Minor Changes

- 0e9536b: Publish the standalone MCP server to npm as `@lisa-mcp/server` (renamed from the private
  `lisa-server`). The package ships the bundled server with a `lisa-mcp` bin — `npx @lisa-mcp/server`
  runs it locally (stdio or HTTP) — plus an MTA deploy template (`templates/mta/`) to deploy LISA to
  SAP BTP Cloud Foundry straight from npm, no repo clone: the template's `nodejs` module
  `npm install`s the published package, provisions the same XSUAA/Destination resources, and
  upgrading LISA becomes a version bump. Publication is automated: pushing a product tag `vX.Y.Z`
  now `npm publish`es the server (with provenance) before cutting the GitHub release.

---

_History before 0.9.0 (the pre-Changesets product changelog, 0.1.0 → 0.9.0) is preserved in the
[frozen root CHANGELOG at the v0.9.0 tag](https://github.com/ClementRingot/LISA/blob/v0.9.0/CHANGELOG.md)._
