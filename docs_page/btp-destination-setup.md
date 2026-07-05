# BTP destination for the `zi18n_service` API

Any **BTP** consumer of LISA's ABAP API — the [LISA MCP server](./btp-deployment.md), a **Joule
Studio** action, a **CAP** service, an **SAP Build** action — reaches `zi18n_service` through a
**BTP destination** that carries the authentication. The destination holds the credential (or the
propagation trust) in BTP's secure store, so the consuming app or agent **never handles a secret**.

This is the canonical "how to create that destination". Creating it is the **same** whatever the
consumer; only who reads it differs.

> **Prerequisite:** the ABAP HTTP service is installed and published on the target system — see
> [ABAP service setup](./abap-service-setup.md). On ABAP Cloud the endpoint activates with the
> HTTP Service object; **per-user propagation needs no communication scenario** (that is only for
> the shared Basic-auth user, below).

## Choose the auth family

| | Per-user propagation | Shared Basic auth |
|---|---|---|
| SAP runs the call as | the **real end user** | one **shared** technical/communication user |
| Audit + authorizations | per user | per that shared user |
| Setup | trust chain + SAP-side user mapping | a stored username/password (+ a communication user on cloud) |
| Use when | you want per-user identity (**recommended**) | quick / non-interactive, or the runtime supports only Basic |

## Per-user propagation (recommended)

Pick the `Authentication` type by backend:

| Backend | `Authentication` | `ProxyType` |
|---|---|---|
| On-premise / private cloud | `PrincipalPropagation` | `OnPremise` (Cloud Connector) |
| BTP ABAP Env — same subaccount | `OAuth2UserTokenExchange` | `Internet` |
| BTP ABAP Env — cross-subaccount | `OAuth2SAMLBearerAssertion` | `Internet` |
| S/4HANA Cloud public | `SAMLAssertion` | `Internet` |

Requirements: (1) the consuming runtime supports user-propagating destinations (check your Joule
Studio / actions version); (2) an IAS/XSUAA trust chain between the caller's subaccount and the
destination's; (3) a SAP-side user mapping — a Cloud Connector certificate mapping on-premise, or
a business user whose **email matches the token** on cloud; (4) for writes, per-user transport
access. `OAuth2UserTokenExchange` is **single-subaccount only** — cross-subaccount uses the
SAML-bearer variant.

> The full destination **property tables** (URLs, token-service endpoints, client keys, `init_data`)
> are already in [BTP deployment §1 — Configure the destinations](./btp-deployment.md#1-configure-the-destinations).
> They are identical whether the consumer is the MCP server or a Joule Studio action — this page is
> the "which type, and why"; that page is the field-by-field recipe.

## Shared Basic auth (technical / communication user)

When you don't set up propagation — or the runtime supports only `BasicAuthentication` — the
destination stores a username/password and **every call runs as that one user**.

| Backend | `Authentication` / `ProxyType` | Credential the destination holds |
|---|---|---|
| On-premise / private cloud | `BasicAuthentication` / `OnPremise` | a **technical user** + password; set `sap-client` on the destination |
| BTP ABAP Env / S/4HANA Cloud public | `BasicAuthentication` / `Internet` | a **communication user** (created below) |

### Cloud — create the communication user (one-time)

1. **Communication scenario** (ADT): a new *Communication Scenario* with `zi18n_service` added as
   an **inbound** HTTP service, authentication method **Basic**.
2. **Communication arrangement** (Fiori app *Communication Arrangements*): create one for that
   scenario, bound to a **communication system** and a **communication user** (username + password).
3. Put that communication user's credentials in the `BasicAuthentication` destination.

Trade-off: no per-user identity or audit — every call is the shared user, and that user's SAP
authorizations gate everything (including which transports writes can record into).

## After creating the destination

- **LISA MCP server** → set `SAP_BTP_DESTINATION` / `SAP_BTP_PP_DESTINATION` to the destination
  name; see [BTP deployment](./btp-deployment.md).
- **Joule Studio / CAP / SAP Build** → bind your action or service to the destination and call the
  API; see the [agent skill](../skills/lisa-abap-api/SKILL.md) for how to use the six actions and
  the [OpenAPI spec](../api/zi18n_service.openapi.yaml) to generate the action.

> **Security:** the credential (or the propagation trust) lives **only** in the destination's BTP
> vault. The consuming app, action, or agent never reads it — do not copy it into a `.env`, an
> action config, or an agent prompt.
