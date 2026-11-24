# Per-user SAP identity without BTP (local SAML bearer)

> **Status: proposed — not started.** Nothing here is implemented in LISA. This page records
> what ARC-1 shipped, how each LISA distribution is affected, and when to resume.

## Context

ARC-1 PR [#1234](https://github.com/arc-mcp/arc-1/pull/1234) (released in ARC-1
[v1.11.0](https://github.com/arc-mcp/arc-1/releases/tag/v1.11.0), 2026-11-22) added an
**experimental, opt-in local SAML bearer issuer**: a self-hosted ARC-1 (Docker / npm) gives each
caller their own SAP identity on an on-premise ABAP system **without** the BTP Destination Service
or Cloud Connector.

```
MCP client ──OIDC JWT──▶ ARC-1  validates issuer + audience, reads an admin-controlled NameID claim
                           │    Authorization: SAML2.0 <assertion signed by ARC-1's local RSA key>
                           ▼
                        ABAP     SAML2 "SAML Bearer Assertion Provider" trusts ARC-1's certificate,
                                 maps NameID (e-mail) → SU01 user, runs the call as that user
```

Key facts from upstream (see ARC-1
[ADR-0011](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0011-local-saml-bearer-issuer.md)
and the [operator guide](https://github.com/arc-mcp/arc-1/blob/main/docs_page/local-sso-experimental.md)):

- Settings: `SAP_PP_ENABLED=true`, `SAP_OIDC_ISSUER`/`SAP_OIDC_AUDIENCE`, and the
  `SAP_PP_SAML_*` group (key and certificate files, issuer, audience = SAML2 local provider name,
  NameID claim and format, optional recipient and TTL).
- Single target, OIDC only. Multi-target, XSUAA and BTP destinations are rejected at startup.
  A failed propagation is a tool error and **never** falls back to `SAP_USER`.
- Each tool call opens one SAP security session, which ARC-1 closes with a best-effort logoff
  after the call.
- **Validated:** SAP_BASIS 758 (A4H) with Keycloak only, reads and writes, `changedBy` = the
  propagated user. The upstream contributor tested SAP_BASIS 816 on an earlier build only.
- **Not validated:** Entra ID and SAP IAS. Entra's `email` claim can be edited by the user, so it
  is **unsuitable** as the NameID. IAS tokens carry no `scope` claim.
- **Residual risk (ARC-1 R25):** SAP_BASIS 758 accepted an unrelated `Recipient`. Upstream
  therefore requires one signing key and certificate per SAP target, and a SAML2 local provider
  name that is unique across every system trusting an ARC-1 certificate.

Upstream tracks the remaining validation as ARC-1 roadmap
[SEC-23](https://github.com/arc-mcp/arc-1/blob/main/docs_page/roadmap.md#sec-23).

## Current state in LISA

- **Standalone server** — `packages/server/src/sap/transport.ts` propagates the user only through
  the BTP Destination Service (`SAP_BTP_PP_DESTINATION`). Off BTP it connects directly with
  `SAP_USER`/`SAP_PASSWORD`, so an OIDC-authenticated caller still reaches SAP as the **technical
  user**. OIDC (`OIDC_ISSUER`/`OIDC_AUDIENCE`) authenticates the caller; it does not change the SAP
  identity.
- **ARC-1 extension** — LISA's `Custom_*` tools call the ABAP service through the host ARC-1's
  `ctx.http`, which is built on the per-request client (`plugin-loader.ts`). In ARC-1 ≥ 1.11.0 the
  SAML-bearer client wraps the whole tool dispatch (`runSamlBearerToolCall` →
  `dispatchWithClient`). LISA should therefore reach SAP as the propagated user **without code
  changes**. This comes from reading the code and has **not** been tested on a live system.

## Direction

### 1. ARC-1 extension — document and verify (small, no LISA code)

1. Run an ARC-1 ≥ 1.11.0 with the local SAML issuer configured and the LISA extension loaded.
2. Verify on a test system:
   - `TranslateListLanguages` and `TranslateGetTexts` succeed with a Keycloak user, and the
     `auth_pp_created` audit event shows `destination=local-saml-bearer`;
   - the `zi18n_service` ICF node accepts the `Authorization: SAML2.0` logon (check its SICF
     logon data when SAP answers a bare `401`);
   - a `TranslateSetTexts` is recorded under the propagated SU01 user, not `SAP_USER`.
3. Then add an "Off BTP: per-user identity" section to
   [`docs_page/arc1-extension-deployment.md`](../docs_page/arc1-extension-deployment.md), linking
   the ARC-1 operator guide instead of copying it, and raise the extension's `arc-1`
   devDependency to `^1.11.0` for the tests. Leave the peer range unchanged: the feature is an
   option of the host ARC-1.

### 2. Standalone server — wait for a shared package (do not port)

Do **not** copy ARC-1's issuer into LISA. It lives in ARC-1's own source
(`src/adt/saml-bearer.ts`, `src/server/saml-bearer-client.ts`), not in `@arc-mcp/xsuaa-auth`.
It adds XML-signature dependencies (`xml-crypto`, `@xmldom/xmldom`), and copying
security-critical signing code is what the [shared-auth track](./shared-auth-module.md) was meant
to avoid. LISA also positions the local mode as dev/test only.

Preferred path: ask ARC-1 to extract the issuer (assertion building and signing, startup
self-check, NameID resolution, per-call security-session logoff) into `@arc-mcp/xsuaa-auth` or a
sibling package. LISA would then adopt it the same way it adopted the XSUAA layer:

- add the `SAP_PP_SAML_*` group to `packages/server/src/server/config.ts`, refusing to start
  unless it is complete, with OIDC configured and no BTP destination;
- in `transport.ts`, when a user JWT is present and the issuer is configured, send
  `Authorization: SAML2.0 <assertion>` with `x-sap-security-session: create` directly to
  `SAP_URL`, never falling back to Basic, and log off the security session afterwards;
- document it next to the existing BTP principal-propagation flow in
  [`docs_page/authentication.md`](../docs_page/authentication.md).

## Resume when

- **Extension (step 1):** an ARC-1 ≥ 1.11.0 test instance with Keycloak and SAML2 trust is
  available (the upstream `examples/local-sso/` templates provide one).
- **Standalone (step 2):** the issuer is published in a shared package, **and** upstream has
  validated it beyond Keycloak/758 (SEC-23: IAS or Entra with an admin-controlled claim, final-build
  816), **or** a LISA user needs per-user SAP identity off BTP without running ARC-1.
