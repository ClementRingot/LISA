# BTP deployment (Cloud Foundry)

`LISA` ships as an MTA and deploys to **SAP BTP, Cloud Foundry runtime**. This page covers the build, the bound services, and the deploy.

## Prerequisites

- A BTP subaccount with the **Cloud Foundry** runtime enabled.
- Entitlements / service plans for: **XSUAA** (`application`), **Destination** (`lite`), **Connectivity** (`lite`), **Application Logs** (`lite`).
- The **ABAP service installed** in the target SAP system (see [ABAP service setup](./abap-service-setup.md)).
- A **Cloud Connector** if the SAP system is on-premise (used by the Connectivity service).
- CLI tools: `cf`, the MultiApps plugin, and `mbt` (`npm i -g mbt`).

## 1. Configure the destinations

Create two BTP destinations pointing at your SAP system. The MCP picks between them automatically:

| Destination | Auth | Used for | `mta.yaml` property |
|-------------|------|----------|---------------------|
| Technical / BasicAuth | `BasicAuthentication` | system-level calls, fallback | `SAP_BTP_DESTINATION` |
| SSO / Principal propagation | `PrincipalPropagation` | per-user calls | `SAP_BTP_PP_DESTINATION` |

Set the two property values in `mta.yaml` to the destination **names** you created. For on-premise systems set `ProxyType=OnPremise` and the Cloud Connector location ID on the destination.

The MCP picks the per-user auth automatically based on what the Destination Service returns, so the only
thing that changes between backends is **how you configure the `SAP_BTP_PP_DESTINATION`**:

| Backend | PP destination `Authentication` | `ProxyType` | Token used |
|---------|---------------------------------|-------------|------------|
| On-premise (Cloud Connector) | `PrincipalPropagation` | `OnPremise` | `SAP-Connectivity-Authentication` |
| SAP BTP ABAP Environment (Steampunk) | `OAuth2SAMLBearerAssertion` | `Internet` | `Authorization: Bearer …` |
| S/4HANA Cloud Public Edition | `SAMLAssertion` | `Internet` | `Authorization: SAML2.0 …` |

### SAP BTP ABAP Environment (per-user OAuth2 SAML bearer)

For the **BTP ABAP Environment** (Steampunk / ABAP Cloud) there is no Cloud Connector — point
`SAP_BTP_PP_DESTINATION` at an `OAuth2SAMLBearerAssertion` destination (`ProxyType=Internet`) whose
`TokenServiceURL` is the ABAP environment's OAuth token endpoint and whose audience/client come from a
Communication Arrangement. The Destination Service exchanges the user JWT for a per-user Bearer token,
which LISA forwards as `Authorization: Bearer …` — **no code change, this path already exists**. Each
user needs a business user whose email matches the JWT.

### S/4HANA Public Cloud (per-user SAMLAssertion)

For **S/4HANA Cloud Public Edition** there is no Cloud Connector — per-user calls use a SAMLAssertion
destination instead of classic principal propagation. Point `SAP_BTP_PP_DESTINATION` at a destination
configured as:

| Field | Value |
|-------|-------|
| Type | `HTTP` |
| URL | the S/4HC API endpoint, e.g. `https://my<NNNNN>-api.s4hana.cloud.sap` |
| Proxy Type | `Internet` (direct routing — **no** Cloud Connector) |
| Authentication | `SAMLAssertion` |
| Audience | the S/4HC OAuth 2.0 SAML2 audience |
| AuthnContextClassRef | `urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession` |
| Name ID Format | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |

On the S/4HC side, export the BTP subaccount signing certificate, upload it under **Communication
Systems**, and enable the **SAML Bearer Assertion Provider**. The MCP maps the JWT email to a business
user, so each user needs a business user with a **matching email** and the developer (extensibility)
role. No extra env var is required — LISA reuses the same `SAP_BTP_PP_DESTINATION` and detects the
SAMLAssertion token automatically, sending it as `Authorization: SAML2.0 …` with
`x-sap-security-session: create`.

## 2. Review `mta.yaml` and `xs-security.json`

- [`mta.yaml`](../mta.yaml) defines the Node.js module, the four required services, and the build commands (`npm ci && npm run build && npm prune --omit=dev`). It sets **no `host:`** — the deploy service assigns a globally-unique `${default-host}` so routes never collide across subaccounts on the shared `cfapps.<region>` domain. Pin a short URL via an extension descriptor (see below).
- [`xs-security.json`](../xs-security.json) configures XSUAA. It contains **only** `xsappname` and `oauth2-configuration` (redirect URIs) — no scopes or roles, by design (see [Authentication](./authentication.md)). Add your MCP client's callback URL to `redirect-uris` if it isn't covered by the existing wildcards.

### Pin a public URL with an extension descriptor (`.mtaext`)

The base `mta.yaml` deliberately ships without a fixed route. To deploy under a short, stable URL your MCP clients can connect to, copy the tracked template and pin a `host:`:

```bash
cp mta-overrides.mtaext.example mta-overrides-dev.mtaext
# edit mta-overrides-dev.mtaext — it keeps the lisa-<space> convention by default,
# so the dev space resolves to https://lisa-dev.cfapps.<region>.../mcp
```

Three tracked templates are provided — copy the one matching your backend:

| Template | Backend scenario |
|----------|------------------|
| [`mta-overrides.mtaext.example`](../mta-overrides.mtaext.example) | Generic / fully-annotated reference |
| [`mta-overrides-onpremise.mtaext.example`](../mta-overrides-onpremise.mtaext.example) | On-premise via Cloud Connector (BasicAuth + PrincipalPropagation) |
| [`mta-overrides-btp-abap.mtaext.example`](../mta-overrides-btp-abap.mtaext.example) | SAP BTP ABAP Environment / Steampunk (technical + OAuth2SAMLBearerAssertion, direct internet) |
| [`mta-overrides-public-cloud.mtaext.example`](../mta-overrides-public-cloud.mtaext.example) | S/4HANA Cloud Public Edition (technical + SAMLAssertion, direct internet) |

Use one file per landscape (e.g. `mta-overrides-dev.mtaext`, `mta-overrides-sbx.mtaext`). All `mta-overrides*.mtaext` are gitignored; the `.example` template is tracked. Override per-landscape destinations and other properties in the same file. The host must be lowercase letters/digits/hyphens and free on the shared region domain (first-come-first-served across **all** subaccounts) — pin a landscape-specific name if `lisa-<space>` ever clashes. When running more than one instance in the **same subaccount** (e.g. sandbox alongside dev), each needs a distinct XSUAA `xsappname` — see the `mta-overrides.mtaext.example` "XSUAA xsappname" block.

## 3. Build

```bash
npm run build --workspace packages/core --workspace packages/server   # server bundles @lisa/core into its dist
mbt build            # → mta_archives/lisa_0.6.0.mtar (matches the version in mta.yaml)
```

`mbt build` doesn't need this first command — it runs its own build inside `mta.yaml`'s `build-parameters` — but running it locally first lets you catch errors before packaging. Only `packages/core` and `packages/server` are built for the standalone deploy; `packages/arc1-extension` is a separate distribution (see [ARC-1 extension deployment](./arc1-extension-deployment.md)) and isn't part of this artifact.

## 4. Deploy

```bash
cf login              # target the right org/space
cf deploy mta_archives/lisa_0.6.0.mtar -e mta-overrides-dev.mtaext
```

Or in one step from npm: `npm run btp:build-deploy-dev` (builds the `.mtar` and deploys it with the extension applied); use `btp:build-deploy-sbx` for the sandbox landscape. Omit `-e mta-overrides-dev.mtaext` / use `npm run btp:build-deploy` to deploy on the auto-assigned default host.

This creates the XSUAA, Destination, Connectivity and App-Logs service instances (if missing) and pushes the app.

## 5. Set the DCR signing secret (important)

```bash
cf set-env lisa-mcp LISA_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"
cf restage lisa-mcp
```

Without this, the OAuth DCR store and state codec sign with the XSUAA `clientsecret`, which `cf deploy` **rotates on every deploy** — invalidating all cached MCP client registrations and in-flight OAuth states. The startup log shows `dcrSigningSource: "env"` once it's set, `"xsuaa"` when falling back.

It's a secret, so it is intentionally **not** in `mta.yaml`.

## 6. Verify

```bash
cf app lisa-mcp                       # RUNNING?
curl https://lisa-<space>.<domain>/health
```

The MCP endpoint is `https://lisa-<space>.<domain>/mcp`. Point your MCP client at it; it will be redirected through XSUAA login (OAuth) on first use.

## Connecting an MCP client to the deployed server

```json
{
  "mcpServers": {
    "lisa": { "url": "https://lisa-<space>.<domain>/mcp" }
  }
}
```

The client performs the XSUAA OAuth flow; the resulting identity is propagated to SAP per call.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Deploy fails creating XSUAA | Entitlement / plan `application` available in the subaccount. |
| `VCAP_SERVICES is unavailable` at runtime | App not bound to XSUAA/Destination — re-deploy via MTA, not `cf push`. |
| 502 / connection refused to SAP | Destination URL, Cloud Connector mapping, `ProxyType`, location ID. |
| S/4HANA Public Cloud per-user calls rejected | SAMLAssertion destination `ProxyType=Internet`; **SAML Bearer Assertion Provider** enabled in S/4HC; business user email matches the JWT; user holds the developer (extensibility) role. |
| Clients re-prompted to log in after every deploy | `LISA_DCR_SIGNING_SECRET` not set (step 5). |
| User can authenticate but gets SAP auth errors | Expected — SAP enforces translation authorization; grant the user the rights in SAP. |
