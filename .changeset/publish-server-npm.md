---
'@lisa-mcp/server': minor
---

Publish the standalone MCP server to npm as `@lisa-mcp/server` (renamed from the private
`lisa-server`). The package ships the bundled server with a `lisa-mcp` bin — `npx @lisa-mcp/server`
runs it locally (stdio or HTTP) — plus an MTA deploy template (`templates/mta/`) to deploy LISA to
SAP BTP Cloud Foundry straight from npm, no repo clone: the template's `nodejs` module
`npm install`s the published package, provisions the same XSUAA/Destination resources, and
upgrading LISA becomes a version bump. Publication is automated: pushing a product tag `vX.Y.Z`
now `npm publish`es the server (with provenance) before cutting the GitHub release.
