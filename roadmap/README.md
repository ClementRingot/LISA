# LISA Roadmap

Forward-looking work for LISA. Everything in this folder is **planned, not implemented** —
treat it as design intent, subject to change.

There are **two independent tracks**:

| Track | Doc | In one line |
|-------|-----|-------------|
| **Distribute LISA as an ARC-1 extension** | [`arc1-extension.md`](./arc1-extension.md) | When the ARC-1 extension framework reaches **v2**, repackage LISA's 3 tools as in-process `Custom_*` tools inside an ARC-1 instance. |
| **Share the auth layer (standalone)** | [`shared-auth-module.md`](./shared-auth-module.md) | Replace LISA's in-tree XSUAA/BTP auth with a dependency on the published [`@arc-mcp/xsuaa-auth`](https://www.npmjs.com/package/@arc-mcp/xsuaa-auth) package. |

> These tracks are **independent**. The extension track is an *additional distribution mode*;
> the standalone LISA server stays maintained in parallel and is **not** replaced by it. The
> auth-sharing track applies to that standalone server regardless of whether the extension is
> ever built.
