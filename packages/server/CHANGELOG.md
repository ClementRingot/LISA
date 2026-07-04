# @lisa-mcp/server

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
