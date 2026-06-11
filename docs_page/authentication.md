# Authentication

## The model: authentication only, no authorization

`sap-translator` deliberately does **authentication only**. It proves *who* is calling; it does **not** decide *what* they may do. That decision belongs to SAP.

- On BTP, the caller logs in via **XSUAA**. The resulting JWT is propagated to SAP through the Destination + Connectivity services (**principal propagation**).
- SAP then enforces its **own authorization objects** — the same ones that already govern translation in your system — under the backed user's identity.
- Therefore there are **no XSUAA scopes, role templates or role collections**. Users need **no BTP role** to use the server; every authenticated principal sees all 5 tools. What they can actually read/write/translate is whatever SAP allows them.

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

## How principal propagation flows (BTP)

```
MCP client ──JWT──▶ sap-translator ──(user JWT)──▶ Destination Service
                                          │            (PP destination)
                                          ▼
                              Cloud Connector / SAP   ← authenticates as the *user*
```

- When a **user JWT is present** and `SAP_BTP_PP_DESTINATION` is set, the SAP client resolves that destination **per user**, attaching `SAP-Connectivity-Authentication` (or a bearer token) so SAP runs the call under the real user.
- Otherwise it falls back to the **BasicAuth** technical destination (`SAP_BTP_DESTINATION`) — used for system-level calls (e.g. listing languages) and for non-interactive callers (stdio, API key).

## OAuth proxy & dynamic client registration

For XSUAA, the server runs an OAuth proxy (ported from [ARC-1](https://github.com/marianfoo/arc-1)) so standard MCP OAuth clients can authenticate against XSUAA, including:

- a **stateless DCR client store** (the `client_id` *is* the signed payload),
- a redirect-URI allowlist mirrored from `xs-security.json`,
- a signed `state` codec that works around XSUAA's literal-`+`-in-state behavior.

All of these sign with `SAP_TRANSLATOR_DCR_SIGNING_SECRET`. **Set it explicitly** (`cf set-env`) so deploys don't rotate the signing key and invalidate cached registrations — see [Configuration reference](./configuration-reference.md#oauth--dcr-btp).

## See also

- [Configuration reference](./configuration-reference.md) — every auth variable.
- [BTP deployment](./btp-deployment.md) — wiring up XSUAA, Destination and Connectivity.
