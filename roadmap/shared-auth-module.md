# Standalone LISA: adopt `@arc-mcp/xsuaa-auth`

> **Status: forward-looking.** Not implemented yet. This concerns the **standalone** LISA MCP
> server and is independent of the [ARC-1 extension track](./arc1-extension.md).

## Context

ARC-1 PR [#455](https://github.com/arc-mcp/arc-1/pull/455) (merged 2026-06-17) extracted
ARC-1's **XSUAA OAuth + RFC 7591 dynamic client registration + BTP principal-propagation** layer
into a standalone npm package, **[`@arc-mcp/xsuaa-auth`](https://www.npmjs.com/package/@arc-mcp/xsuaa-auth)**.
PR [#456](https://github.com/arc-mcp/arc-1/pull/456) then made ARC-1 itself consume that
package — deleting its in-tree auth code (**−3621 LOC**, behaviour unchanged). PR #455 names LISA
explicitly as an intended consumer: other SAP MCP servers (calmcp, LISA) should depend on the
package instead of copy-pasting the layer.

## Current state in LISA

LISA today reimplements the same stack in-tree — these are exactly the files ARC-1 removed in #456:

- `src/server/xsuaa.ts`
- `src/server/oauth-state.ts`
- `src/server/stateless-client-store.ts`
- `src/sap/btp.ts`

(LISA's README already states it is "built the same way as ARC-1 — same XSUAA auth proxy, same
BTP connectivity model.")

## Direction

Replace that in-tree code with a dependency on `@arc-mcp/xsuaa-auth` and its `./btp` sub-module.

> **Pin the floor at `^0.1.2`.** Versions 0.1.0 / 0.1.1 issue a `client_secret` for **public PKCE
> clients** (Cursor, Eclipse, VS Code Copilot → "Client secret is required"). 0.1.2 fixes this
> (`token_endpoint_auth_method: "none"`).

### Benefits

- Large LOC reduction (ARC-1 saw −3621).
- Shared security fixes (e.g. the public-PKCE fix above) instead of divergent copies.
- Behaviour parity with ARC-1; less drift between the two servers.

## Migration outline

Mirrors ARC-1 #456. Presented as a plan, not an executed diff.

1. Add `@arc-mcp/xsuaa-auth@^0.1.2` (and its `./btp` sub-module) to `package.json`.
2. Delete the in-tree files listed above **and their now-redundant unit tests**
   (`*.test.ts` covered by the package's own suite).
3. Repoint `src/server/http.ts`, `src/server/server.ts`, and `src/sap/i18n-client.ts` to the
   package's building blocks.
4. **Keep LISA-specific pieces**:
   - LISA's own transport / `startHttpServer` wiring;
   - the DCR signing secret (`LISA_DCR_SIGNING_SECRET`);
   - the 3-tool surface (`TranslateListLanguages` / `TranslateGetTexts` / `TranslateSetTexts`);
   - a small logger adapter bridging LISA's audit events to the package `Logger`.
5. Validate: `build` / typecheck / lint clean; full test suite green; and a **live BTP E2E** —
   XSUAA token validation against a real token + public/PKCE OAuth flow with no secret sent.

## References

- PR #455 — extraction (research + spec): https://github.com/arc-mcp/arc-1/pull/455
- PR #456 — ARC-1 adopts the package: https://github.com/arc-mcp/arc-1/pull/456
- npm package: https://www.npmjs.com/package/@arc-mcp/xsuaa-auth
