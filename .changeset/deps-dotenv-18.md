---
'@lisa-mcp/server': patch
---

Upgrade `dotenv` from 17 to 18. LISA loads `.env` through `import 'dotenv/config'`, which v18 still supports, and it never used the preloading or `.env.vault` features that v18 removed. One visible change: when a `.env` file is present, dotenv now prints its "injected env" line to stderr instead of stdout. stdout carries the MCP JSON-RPC stream in stdio mode, and it stays clean either way (verified).
