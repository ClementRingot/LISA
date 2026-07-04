---
'@lisa-mcp/server': patch
---

Fix the deploy-from-npm MTA template and enrich the published tarball. The template's MTA ID is
now `lisa` (was `lisa-npm`, which silently prevented every `mta-overrides*.mtaext`
(`extends: lisa`) from applying to npm-based deploys — and made source-build and npm deploys land
as two separate MTA deployments instead of upgrading one). The tarball now also ships the four
per-backend landscape override templates (`templates/mta/mta-overrides*.mtaext.example`) and the
commented `.env.example` for local `npx @lisa-mcp/server` usage.
