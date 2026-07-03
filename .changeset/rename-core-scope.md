---
---

chore: rename the private `@lisa/core` package to `@lisa-mcp/core` for scope
consistency with the public `@lisa-mcp/arc1-extension`. No shipped behaviour
changes — `@lisa-mcp/core` stays private and is inlined by esbuild into both the
server and extension bundles, which are identical aside from the internal package
name. Deliberate no-release, hence an empty changeset.
