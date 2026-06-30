# BTP deployment (Cloud Foundry)

`LISA` ships as an MTA and deploys to **SAP BTP, Cloud Foundry runtime**. This page covers the build, the bound services, and the deploy.

## Prerequisites

- A BTP subaccount with the **Cloud Foundry** runtime enabled.
- Entitlements / service plans for: **XSUAA** (`application`) and **Destination** (`lite`) — always required.
  **Connectivity** (`lite`) is only needed for the on-premise (Cloud Connector) scenario, and **Application Logs** (`lite`) is optional; both are shipped **`active: false`** in `mta.yaml` (see [Optional services](#optional-services-connectivity--application-logs)).
- The **ABAP service installed** in the target SAP system (see [ABAP service setup](./abap-service-setup.md)).
- A **Cloud Connector** if the SAP system is on-premise (used by the Connectivity service).
- CLI tools: `cf`, the MultiApps plugin, and `mbt` (`npm i -g mbt`).

## 1. Configure the destinations

Create two BTP destinations pointing at your SAP system. The MCP picks between them automatically:

| Destination | Auth | Used for | `mta.yaml` property |
|-------------|------|----------|---------------------|
| Technical | `BasicAuthentication` / `OAuth2ClientCredentials` | system-level calls, fallback, **startup check** | `SAP_BTP_DESTINATION` |
| SSO / Principal propagation | `PrincipalPropagation` / `OAuth2*` / `SAMLAssertion` | per-user calls (the real work) | `SAP_BTP_PP_DESTINATION` |

Set the two property values in `mta.yaml` to the destination **names** you created. For on-premise systems set `ProxyType=OnPremise` and the Cloud Connector location ID on the destination.

> **The "technical" `SAP_BTP_DESTINATION` is mostly a startup formality.** Config validation requires `SAP_BTP_DESTINATION` *or* `SAP_URL` to be set (`packages/server/src/server/config.ts`), and it is only ever used when **no** user JWT is present (stdio / API-key calls). For the Internet-facing cloud backends below, every interactive MCP call carries a JWT and therefore flows through `SAP_BTP_PP_DESTINATION` — so a minimal technical destination (e.g. `OAuth2ClientCredentials` pointing at the same system, reusing the same token endpoint) is enough to satisfy the check. **All real per-user work goes through `SAP_BTP_PP_DESTINATION`.**

The MCP picks the per-user auth automatically based on what the Destination Service returns, so the only
thing that changes between backends is **how you configure the `SAP_BTP_PP_DESTINATION`**:

| Backend | PP destination `Authentication` | `ProxyType` | Token used |
|---------|---------------------------------|-------------|------------|
| On-premise (Cloud Connector) | `PrincipalPropagation` | `OnPremise` | `SAP-Connectivity-Authentication` |
| SAP BTP ABAP Environment — **same subaccount (recommended)** | `OAuth2UserTokenExchange` | `Internet` | `Authorization: Bearer …` |
| SAP BTP ABAP Environment — different subaccounts / advanced | `OAuth2SAMLBearerAssertion` | `Internet` | `Authorization: Bearer …` |
| S/4HANA Cloud Public Edition | `SAMLAssertion` | `Internet` | `Authorization: SAML2.0 …` |

### SAP BTP ABAP Environment (Steampunk)

There is no Cloud Connector for the **BTP ABAP Environment** (Steampunk / ABAP Cloud) — calls go direct
over the internet (`ProxyType=Internet`). The Destination Service exchanges the user JWT for a per-user
Bearer token, which LISA forwards verbatim as `Authorization: Bearer …` — **no code change, this path
already exists** (`packages/server/src/sap/transport.ts`). There are two ways to configure the per-user
`SAP_BTP_PP_DESTINATION`; pick by whether LISA and the ABAP env share a subaccount.

#### Same subaccount (recommended): `OAuth2UserTokenExchange`

When LISA and the ABAP Environment live in the **same** BTP subaccount, configure the per-user
destination with `Authentication=OAuth2UserTokenExchange`. This is an XSUAA→XSUAA token exchange — **no
Communication Arrangement, no SAML trust, no OAuth client registration on the ABAP side**. Every value
comes straight from the ABAP instance's **service key** (`uaa` section); create one with
`cf create-service-key <abap-instance> <key>` then `cf service-key <abap-instance> <key>`.

| Property | Value |
|----------|-------|
| Type | `HTTP` |
| URL | service-key `url` (the ABAP system) |
| Proxy Type | `Internet` |
| Authentication | `OAuth2UserTokenExchange` |
| Token Service URL | `<service-key uaa.url>/oauth/token` |
| Token Service URL Type | `Dedicated` |
| Client ID / Secret | service-key `uaa.clientid` / `uaa.clientsecret` |

> ⚠️ **`OAuth2UserTokenExchange` is scoped to ONE subaccount.** It exchanges the caller's XSUAA token
> for an ABAP XSUAA token *within the same subaccount*. If LISA and the ABAP env are in **different**
> subaccounts (or behind different IdPs) it will not work — use the SAML-bearer option below instead.

The technical `SAP_BTP_DESTINATION` here only satisfies the startup check (see the note under
[Configure the destinations](#1-configure-the-destinations)) — point it at the same ABAP system with
`Authentication=OAuth2ClientCredentials`, reusing the same `uaa` token endpoint
(`<service-key uaa.url>/oauth/token`). Each user still needs a business user whose **email** matches the JWT.

#### Different subaccounts / advanced: `OAuth2SAMLBearerAssertion`

For cross-subaccount (or cross-IdP) access, point `SAP_BTP_PP_DESTINATION` at an
`OAuth2SAMLBearerAssertion` destination (`ProxyType=Internet`) whose `TokenServiceURL` is the **ABAP
environment's own** OAuth token endpoint (`https://<host>.abap.<region>.hana.ondemand.com/sap/bc/sec/oauth2/token`)
and whose audience/client come from a Communication Arrangement. You must establish SAML trust to the BTP
subaccount IdP and register the OAuth 2.0 client on the ABAP side. The Destination Service exchanges the
user JWT for a per-user Bearer token, which LISA forwards as `Authorization: Bearer …`. Each user needs a
business user whose email matches the JWT.

See [`mta-overrides-btp-abap.mtaext.example`](../mta-overrides-btp-abap.mtaext.example) for both option
(A) and (B) destination property lists, including how to provision them as instance-level destinations
via the destination service `init_data`.

### S/4HANA Public Cloud (per-user SAMLAssertion)

For **S/4HANA Cloud Public Edition** (developer extensibility / ABAP Cloud), **principal propagation via
a `SAMLAssertion` destination is the ONLY supported path** — there is no technical-user / Basic path for
ADT-style developer access. There is no Cloud Connector either: calls go direct over the internet
(`ProxyType=Internet`). LISA reuses the same `SAP_BTP_PP_DESTINATION` and detects the SAMLAssertion token
automatically, sending it verbatim as `Authorization: SAML2.0 …` with `x-sap-security-session: create`
(`packages/server/src/sap/transport.ts`) — **no extra env var, no code change**.

Because pure principal propagation is the only path, the technical `SAP_BTP_DESTINATION` here is **only**
there to satisfy the startup config check (`packages/server/src/server/config.ts`) and is otherwise
**unused** for developer calls. Point it at the same S/4HC API host with `OAuth2ClientCredentials` — or
see [Relaxing the technical-destination requirement](#relaxing-the-technical-destination-requirement-pp-only-backends)
to drop it entirely.

**Reuse your existing BAS destination.** The SAMLAssertion destination is the *same one* SAP Business
Application Studio uses (typically named `<SYSTEM_ID>_SAML_ASSERTION`). If you already connect BAS to
this system, you can point `SAP_BTP_PP_DESTINATION` straight at that destination — no new destination
needed. See the SAP tutorial [Connect SAP Business Application Studio and SAP S/4HANA Cloud System](https://developers.sap.com/tutorials/abap-environment-trial-onboarding.html).

Point `SAP_BTP_PP_DESTINATION` at a destination configured as:

| Field | Value |
|-------|-------|
| Type | `HTTP` |
| URL | the S/4HC API endpoint, e.g. `https://my<NNNNN>-api.s4hana.cloud.sap` |
| Proxy Type | `Internet` (direct routing — **no** Cloud Connector) |
| Authentication | `SAMLAssertion` |
| Audience | the S/4HC OAuth 2.0 SAML2 audience (the SAML2 local provider name) |
| AuthnContextClassRef | `urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession` |
| Name ID Format | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| Client Key | _(leave empty)_ |

Also enable **Use default JDK truststore** on the destination so the public S/4HC TLS certificate is
trusted. See [`mta-overrides-public-cloud.mtaext.example`](../mta-overrides-public-cloud.mtaext.example)
for the full property list, including the harmless BAS hint properties you keep when reusing the BAS
destination.

#### Set up the SAML trust

1. **BTP subaccount → Connectivity → Destination Trust → Generate Trust.** Then **Export** the
   subaccount signing certificate (PEM).
2. **S/4HANA Cloud → Communication Systems → New.** Create a system, enable **Inbound Only**, set
   **SAML Bearer Assertion Provider = ON**, **upload the BTP certificate** you exported, and set the
   **SAML Bearer Issuer** to the certificate's Subject CN.

No communication arrangement or communication user is needed for the developer connection.

> **Each MCP user needs an S/4HC business user whose EMAIL matches the JWT, holding a developer
> (extensibility) business role.** Without it the call fails even though the SAML assertion is accepted
> (see Troubleshooting).

#### Relaxing the technical-destination requirement (PP-only backends)

> **Proposed — not yet implemented.** For a pure principal-propagation cloud backend (S/4HC, or the
> same-subaccount BTP ABAP path) the technical `SAP_BTP_DESTINATION` is vestigial: it exists only to
> pass the `SAP_BTP_DESTINATION` *or* `SAP_URL` startup check in
> [`packages/server/src/server/config.ts`](../packages/server/src/server/config.ts), yet every
> interactive call carries a JWT and goes through `SAP_BTP_PP_DESTINATION`. ARC-1 requires only its PP
> destination for this case. To match it, `resolveConfig()` should accept `SAP_BTP_PP_DESTINATION`
> **alone** as a valid startup configuration, and `resolveConnection()` in
> [`transport.ts`](../packages/server/src/sap/transport.ts) should enter the BTP branch on
> `btpDestination || btpPpDestination` (throwing a clear error only on a *non-JWT* call when no
> technical destination is configured, since system-level/stdio calls genuinely need one). This is a
> behaviour change to the request path, so it should land behind review **with a `config.test.ts` case**
> covering "PP destination only" — until then, keep the minimal technical `SAP_BTP_DESTINATION`.

## 2. Review `mta.yaml` and `xs-security.json`

- [`mta.yaml`](../mta.yaml) defines the Node.js module, the bound services (XSUAA + Destination required; Connectivity and Application Logs ship `active: false` — see [Optional services](#optional-services-connectivity--application-logs)), and the build commands (`npm ci && npm run build && npm prune --omit=dev`). It sets **no `host:`** — the deploy service assigns a globally-unique `${default-host}` so routes never collide across subaccounts on the shared `cfapps.<region>` domain. Pin a short URL via an extension descriptor (see below).
- [`xs-security.json`](../xs-security.json) configures XSUAA. It contains **only** `xsappname` and `oauth2-configuration` (redirect URIs) — no scopes or roles, by design (see [Authentication](./authentication.md)). Add your MCP client's callback URL to `redirect-uris` if it isn't covered by the existing wildcards.

### Pin a public URL with an extension descriptor (`.mtaext`)

The base `mta.yaml` deliberately ships without a fixed route. To deploy under a short, stable URL your MCP clients can connect to, copy the tracked template and pin a `host:`:

```bash
cp mta-overrides.mtaext.example mta-overrides-dev.mtaext
# edit mta-overrides-dev.mtaext — it keeps the lisa-<space> convention by default,
# so the dev space resolves to https://lisa-dev.cfapps.<region>.../mcp
```

Four tracked templates are provided — copy the one matching your backend:

| Template | Backend scenario |
|----------|------------------|
| [`mta-overrides.mtaext.example`](../mta-overrides.mtaext.example) | Generic / fully-annotated reference |
| [`mta-overrides-onpremise.mtaext.example`](../mta-overrides-onpremise.mtaext.example) | On-premise via Cloud Connector (BasicAuth + PrincipalPropagation; re-activates `lisa-connectivity`) |
| [`mta-overrides-btp-abap.mtaext.example`](../mta-overrides-btp-abap.mtaext.example) | SAP BTP ABAP Environment / Steampunk (OAuth2UserTokenExchange same-subaccount, or OAuth2SAMLBearerAssertion; direct internet) |
| [`mta-overrides-public-cloud.mtaext.example`](../mta-overrides-public-cloud.mtaext.example) | S/4HANA Cloud Public Edition (per-user SAMLAssertion, direct internet) |

Use one file per landscape (e.g. `mta-overrides-dev.mtaext`, `mta-overrides-sbx.mtaext`). All `mta-overrides*.mtaext` are gitignored; the `.example` template is tracked. Override per-landscape destinations and other properties in the same file. The host must be lowercase letters/digits/hyphens and free on the shared region domain (first-come-first-served across **all** subaccounts) — pin a landscape-specific name if `lisa-<space>` ever clashes. When running more than one instance in the **same subaccount** (e.g. sandbox alongside dev), each needs a distinct XSUAA `xsappname` — see the `mta-overrides.mtaext.example` "XSUAA xsappname" block.

### Optional services (Connectivity + Application Logs)

`mta.yaml` ships **two of its four service resources `active: false`** so a vanilla deploy needs only XSUAA + Destination:

| Resource | Service | Default | Why off / when to turn on |
|----------|---------|---------|---------------------------|
| `lisa-connectivity` | `connectivity` (`lite`) | **`active: false`** | Only the on-premise Cloud Connector path uses it; the Internet-facing cloud backends (`ProxyType=Internet`) never touch it. The **on-premise template re-activates it.** |
| `lisa-logs` | `application-logs` (`lite`) | **`active: false`** | SAP removed Application Logging from the eligible services on **2025-07-31** ([SAP Note 3557260](https://me.sap.com/notes/3557260)); binding it **hard-fails the deploy** on subaccounts that no longer offer it. LISA logs to **stderr** regardless, so `cf logs lisa-mcp` works without it. |

An inactive resource makes the deploy service silently ignore every `requires` that points at it, so the app deploys without the binding. Re-enable either one from your `mtaext` by re-declaring the resource as active:

```yaml
resources:
  - name: lisa-logs          # or lisa-connectivity
    active: true
```

The on-premise template ([`mta-overrides-onpremise.mtaext.example`](../mta-overrides-onpremise.mtaext.example)) already does this for `lisa-connectivity`.

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

This creates the **XSUAA and Destination** service instances (if missing) and pushes the app. Connectivity and App-Logs are created only when you re-activate them (see [Optional services](#optional-services-connectivity--application-logs)).

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
| Deploy fails creating `application-logs` | SAP retired the service (SAP Note 3557260) — `lisa-logs` is `active: false` by default; don't re-enable it on that subaccount. App logs go to stderr (`cf logs lisa-mcp`). |
| `VCAP_SERVICES is unavailable` at runtime | App not bound to XSUAA/Destination — re-deploy via MTA, not `cf push`. |
| 502 / connection refused to SAP | Destination URL, Cloud Connector mapping, `ProxyType`, location ID. |
| S/4HANA Public Cloud per-user calls rejected | SAMLAssertion destination `ProxyType=Internet`; **SAML Bearer Assertion Provider** enabled in S/4HC; business user email matches the JWT; user holds the developer (extensibility) role. |
| Clients re-prompted to log in after every deploy | `LISA_DCR_SIGNING_SECRET` not set (step 5). |
| User can authenticate but gets SAP auth errors | Expected — SAP enforces translation authorization; grant the user the rights in SAP. |

### S/4HANA Cloud Public Edition — SAMLAssertion verification

**Healthy signals in the logs** (`LOG_LEVEL: debug` if needed):

- the Destination Service principal-propagation response lists a **SAML auth token**;
- the per-user destination resolves with `hasSamlAssertion: true`;
- the auth event logs `success: true`.

**Failure modes:**

| Symptom | Likely cause |
|---------|--------------|
| Log: *"no SAML assertion returned"* / per-user falls back to the technical destination | `Authentication` is not exactly `SAMLAssertion`; **or** the BTP trust certificate was not uploaded / **SAML Bearer Assertion Provider** is OFF in the S/4HC Communication System. |
| Assertion accepted but ADT/HTTP **401** / *"not successfully logged on"* | No S/4HC business user with a **matching email**, or the user is missing the **developer (extensibility)** business role. |
| Requests **time out**, but only when the connectivity service is bound | Internet destinations must connect **direct** — ensure `ProxyType=Internet` (and that you didn't accidentally re-activate `lisa-connectivity` for this Internet-facing backend). |
