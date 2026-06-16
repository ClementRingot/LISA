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

## 2. Review `mta.yaml` and `xs-security.json`

- [`mta.yaml`](../mta.yaml) defines the Node.js module, the four required services, and the build commands (`npm ci && npm run build && npm prune --omit=dev`). It sets **no `host:`** — the deploy service assigns a globally-unique `${default-host}` so routes never collide across subaccounts on the shared `cfapps.<region>` domain. Pin a short URL via an extension descriptor (see below).
- [`xs-security.json`](../xs-security.json) configures XSUAA. It contains **only** `xsappname` and `oauth2-configuration` (redirect URIs) — no scopes or roles, by design (see [Authentication](./authentication.md)). Add your MCP client's callback URL to `redirect-uris` if it isn't covered by the existing wildcards.

### Pin a public URL with an extension descriptor (`.mtaext`)

The base `mta.yaml` deliberately ships without a fixed route. To deploy under a short, stable URL your MCP clients can connect to, copy the tracked template and pin a `host:`:

```bash
cp mta-overrides.mtaext.example mta-overrides.mtaext
# edit mta-overrides.mtaext — it keeps the lisa-<space> convention by default,
# so the dev space resolves to https://lisa-dev.cfapps.<region>.../mcp
```

The real `mta-overrides.mtaext` is gitignored; the `.example` template is tracked. Override per-landscape destinations and other properties in the same file. The host must be lowercase letters/digits/hyphens and free on the shared region domain (first-come-first-served across **all** subaccounts) — pin a landscape-specific name if `lisa-<space>` ever clashes.

## 3. Build

```bash
npm run build
mbt build            # → mta_archives/lisa_0.1.0.mtar
```

## 4. Deploy

```bash
cf login              # target the right org/space
cf deploy mta_archives/lisa_0.1.0.mtar -e mta-overrides.mtaext
```

Or in one step from npm: `npm run btp:build-deploy-ext` (builds the `.mtar` and deploys it with the extension applied). Omit `-e mta-overrides.mtaext` / use `npm run btp:build-deploy` to deploy on the auto-assigned default host.

This creates the XSUAA, Destination, Connectivity and App-Logs service instances (if missing) and pushes the app.

## 5. Set the DCR signing secret (important)

```bash
cf set-env lisa-mcp LISA_DCR_SIGNING_SECRET "$(openssl rand -hex 32)"
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
| Clients re-prompted to log in after every deploy | `LISA_DCR_SIGNING_SECRET` not set (step 5). |
| User can authenticate but gets SAP auth errors | Expected — SAP enforces translation authorization; grant the user the rights in SAP. |
