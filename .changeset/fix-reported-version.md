---
'@lisa-mcp/server': patch
---

Report the real server version in `/health` and in the MCP `serverInfo`. When the server was not started through an npm script (the Docker image, `node dist/index.js`, `npx @lisa-mcp/server`), both showed a stale hard-coded `0.6.2`. Under `npx` they could also show the calling project's version. The build now bakes the version from the package's own `package.json` into the bundle.
