# Authentication

## The model: authentication only, no authorization

`LISA` deliberately does **authentication only**. It proves *who* is calling; it does **not** decide *what* they may do. That decision belongs to SAP.

- On BTP, the caller logs in via **XSUAA**. The resulting JWT is propagated to SAP through the Destination + Connectivity services (**principal propagation**).
- SAP then enforces its **own authorization objects** — the same ones that already govern translation in your system — under the backed user's identity.
- Therefore there are **no XSUAA scopes, role templates or role collections**. Users need **no BTP role** to use the server; every authenticated principal sees all 3 tools. What they can actually read/write/translate is whatever SAP allows them.

`xs-security.json` reflects this: it has only `xsappname` and `oauth2-configuration` (redirect URIs) — no `scopes`, no `role-templates`.

> Do not reintroduce scope/role gating unless you specifically need MCP-level authorization on top of SAP's.

## Supported authentication methods

Authentication is **active only when at least one** method is configured. With none set, the HTTP transport is open — acceptable for `stdio`/local testing, **not** for anything reachable.

| Method | Configure with | Typical use |
|--------|----------------|-------------|
| **None** | _(no auth vars set)_ | Local dev, `stdio`. |
| **API key** | `SAP_API_KEYS=key:profile,…` (`viewer`/`developer`/`admin`) | Simple machine-to-machine. |
| **OIDC / JWT** | `OIDC_ISSUER`, `OIDC_AUDIENCE` | Entra ID and other OIDC IdPs. |
| **XSUAA** | bound XSUAA service (`VCAP_SERVICES`) | BTP production — enables the OAuth proxy + principal propagation. |

The token verifier is **chained**: XSUAA → OIDC → API key. The first one that validates wins.

> The XSUAA *setup* itself (binding the service, destinations, token exchange, DCR signing secret, redirect URIs) lives in [BTP deployment](./btp-deployment.md) — it's deployment wiring, not a separate auth model. The notes below cover the two non-XSUAA methods, which the shared `@arc-mcp/xsuaa-auth` verifier validates the same way ARC-1 does.

### API key — operational notes

Set `SAP_API_KEYS=key:profile,…` (each profile one of `viewer` / `developer` / `admin`). Under LISA's **authentication-only** model the profile is **not a permission level** — it only becomes the caller's identity label `api-key:<profile>` in logs/audit (`packages/server/src/server/http.ts`). It grants and restricts nothing; what the call may do is decided entirely by SAP. Pick the label that documents who the key is for; it has no functional effect on LISA's side.

API-key callers carry **no user JWT**, so their SAP calls go through the **technical** destination (`SAP_BTP_DESTINATION`) under one system identity — there is no per-user principal propagation for them. Reserve API keys for machine-to-machine / non-interactive use; for a per-user audit trail at SAP, use XSUAA or OIDC.

Best practices:

- Use **cryptographically random** keys with sufficient entropy (e.g. `openssl rand -base64 32`), never guessable strings.
- **Rotate** on a schedule (quarterly is a reasonable default) and immediately on suspected compromise.
- Keep them out of the descriptor — pass via `cf set-env`, not `mta.yaml`.

### OIDC / JWT — operational notes

Set `OIDC_ISSUER` and `OIDC_AUDIENCE`. The verifier validates per the OAuth 2.0 protected-resource model — JWKS signature, issuer match, audience match, expiry — and extracts **no scopes** (authentication only).

> **`OIDC_AUDIENCE` is mandatory when OIDC is enabled.** Without it the verifier would accept **any** token signed by the issuer — including one minted for a *different* app on a **shared issuer** (e.g. another Entra application in the same tenant), a token-confusion / confused-deputy risk ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)). So if `OIDC_ISSUER` is set without `OIDC_AUDIENCE`, **the server refuses to start**. The only way to run without audience validation is the explicit, discouraged opt-out `OIDC_ALLOW_ANY_AUDIENCE=true` (the server then logs a loud warning at every start).

Verification checklist when sign-in fails:

- **`OIDC_ISSUER` matches the token's `iss` claim exactly** — trailing slashes matter (`…/v2.0` ≠ `…/v2.0/`).
- **`OIDC_AUDIENCE` matches the token's `aud` claim.** Decode a real token (e.g. at [jwt.ms](https://jwt.ms)) and compare.
  - **Entra ID caveat:** a **v2.0** token (`requestedAccessTokenVersion: 2`) carries the raw client-id GUID in `aud`; a **v1.0** token (the default) carries `api://{client-id}`. Set `OIDC_AUDIENCE` to whichever your tokens actually use.
- The issuer's **discovery / JWKS endpoint** (`{issuer}/.well-known/openid-configuration`) is reachable from the LISA server.
- The issuer's **TLS certificate is valid** (no self-signed chain).

## How principal propagation flows (BTP)

```
MCP client ──JWT──▶ LISA ──(user JWT)──▶ Destination Service
                                          │            (PP destination)
                                          ▼
                              Cloud Connector / SAP   ← authenticates as the *user*
```

- When a **user JWT is present** and `SAP_BTP_PP_DESTINATION` is set, the SAP client resolves that destination **per user**, attaching `SAP-Connectivity-Authentication` (or a bearer token) so SAP runs the call under the real user.
- Otherwise it falls back to the **BasicAuth** technical destination (`SAP_BTP_DESTINATION`) — used for system-level calls (e.g. listing languages) and for non-interactive callers (stdio, API key).

## OAuth proxy & dynamic client registration

For XSUAA, the server runs an OAuth proxy provided by the [`@arc-mcp/xsuaa-auth`](https://www.npmjs.com/package/@arc-mcp/xsuaa-auth) package (the XSUAA/OAuth layer extracted from [ARC-1](https://github.com/arc-mcp/arc-1)) so standard MCP OAuth clients can authenticate against XSUAA, including:

- a **stateless DCR client store** (the `client_id` *is* the signed payload),
- a redirect-URI allowlist mirrored from `xs-security.json` (LISA passes its own list to the package),
- a signed `state` codec that works around XSUAA's literal-`+`-in-state behavior.

LISA wires these building blocks in `src/server/http.ts` and keeps its own `/oauth/callback` handler; the package also supplies the chained token verifier (XSUAA → OIDC → API key) and the BTP principal-propagation layer.

All of these sign with `LISA_DCR_SIGNING_SECRET`. **Set it explicitly** (`cf set-env`) so deploys don't rotate the signing key and invalidate cached registrations — see [Configuration reference](./configuration-reference.md#oauth--dcr-btp).

## See also

- [Configuration reference](./configuration-reference.md) — every auth variable.
- [BTP deployment](./btp-deployment.md) — wiring up XSUAA, Destination and Connectivity.
