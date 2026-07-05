---
name: lisa-abap-api
description: >-
  Wire LISA's ZCL_I18N_SERVICE ABAP HTTP API into a BTP integration (Joule Studio actions, CAP,
  SAP Build) through a BTP destination — to read, write and compare SAP object translations (data
  elements, domains, CDS views, message classes, text pools, text tables, and more). The
  destination handles authentication — per-user principal propagation (PrincipalPropagation,
  OAuth2UserTokenExchange, OAuth2SAMLBearerAssertion, SAMLAssertion) or a shared BasicAuthentication
  user (technical user on-premise/private cloud; communication user from a communication scenario +
  arrangement on cloud) — with the credential kept in the destination's vault, so this skill never
  handles a secret. Covers destination setup per landscape, all six actions, the JSON wire
  contract, and an importable OpenAPI spec. If you'd rather a runtime component (not a destination)
  hold the credential and expose the tools, run the LISA MCP server instead.
---

# LISA ABAP API — via a BTP destination (no MCP server, no secret in the agent)

The whole API is **one ABAP HTTP service** (`zi18n_service`, handler class `ZCL_I18N_SERVICE`)
installed on the target SAP system. This skill calls it **from BTP through a destination**: the
destination authenticates every call, so **no credential is ever handled here** — nothing to read
from a `.env`, no `Authorization` header to build, no secret in the agent's context.

> **The credential must never live where the agent can read it.** That is the rule — not "no Basic
> auth". A BTP destination is safe **including with `BasicAuthentication`**, because the password
> sits in the destination's vault, not in a `.env` the agent could `cat`. What this skill forbids
> is the agent holding the secret itself (a hand-built `curl -u user:pass`, a `.env` it reads).
> If you'd rather a **runtime component** hold credentials and expose the three tools directly —
> no BTP destination in the loop — run the **LISA MCP server**
> ([`@lisa-mcp/server`](https://www.npmjs.com/package/@lisa-mcp/server)) or the ARC-1 extension.

Every action is a **POST** of a JSON body to `{destination}{path}/{action}`; responses use one
envelope:

```jsonc
{ "success": true,  "data": { … } }            // HTTP 200
{ "success": false, "error": { "code": "…", "message": "…" } }   // HTTP 400
```

Default path: `/sap/bc/http/sap/zi18n_service`. Actions: `capabilities`, `list_languages`,
`list_texts`, `get_translation`, `set_translation`, `compare_translations` — full request/response
shapes, selectors and error codes are in [reference.md](./reference.md).

## The destination carries the auth

Point the BTP destination at the SAP system with an auth type that matches the backend. **Whatever
the type, the credential lives in the destination's secure store — never in the skill or the
agent's context.** That is the property that makes this path safe: the agent only ever names a
destination and sends a JSON body.

**Per-user propagation** — every call runs under the identity of the actual end user (per-user SAP
authorizations + clean audit, no shared user):

| Backend | Destination `Authentication` | SAP receives |
|---|---|---|
| On-premise / private cloud | `PrincipalPropagation` (`ProxyType=OnPremise`, Cloud Connector) | the real business user |
| BTP ABAP Env — same subaccount | `OAuth2UserTokenExchange` | per-user Bearer |
| BTP ABAP Env — cross-subaccount | `OAuth2SAMLBearerAssertion` | per-user Bearer |
| S/4HANA Cloud public | `SAMLAssertion` | per-user `SAML2.0 …` |

Conditions for propagation: (1) the runtime supports user-propagating destination auth types
(check your Joule Studio / actions version); (2) the IAS/XSUAA identity trust chain between the
caller's subaccount and the destination's; (3) a SAP-side user mapping (Cloud Connector cert
mapping on-premise; a business user with matching email on cloud) — plus per-user transport access
for writes. `OAuth2UserTokenExchange` only works within ONE subaccount.

**Basic auth (shared technical / communication user)** — when propagation isn't set up (or the
runtime supports only `BasicAuthentication` destinations), the destination stores a
`BasicAuthentication` credential and every call runs under **one shared user**:

| Backend | Destination `Authentication` | Credential the destination holds |
|---|---|---|
| On-premise / private cloud | `BasicAuthentication` (`ProxyType=OnPremise`, Cloud Connector) | the **technical user** + password; set `sap-client` on the destination |
| BTP ABAP Env / S/4HANA Cloud public | `BasicAuthentication` | the **communication user** created by the communication scenario + arrangement (see below) |

This is the same technical-user / communication-arrangement setup as a raw Basic-auth call — the
only, crucial difference is **where the password lives: in the BTP destination's vault, not in a
`.env` the agent reads**. Trade-off vs propagation: no per-user identity or audit (all calls are
the shared user), and that user's SAP authorizations gate everything.

> **Cloud communication user (one-time):** create a **communication scenario** in ADT with the
> `zi18n_service` HTTP service as an inbound service (auth = Basic), then a **communication
> arrangement** (Fiori: *Communication Arrangements*) binding it to a communication system + a
> **communication user**. Put that user in the `BasicAuthentication` destination. On ABAP
> Environment the endpoint itself activates with the HTTP Service object — the arrangement exists
> only to mint the callable Basic-auth user.

Either way the agent handles no secret. If you instead want credentials held by a first-class
runtime (not a destination) with the three tools exposed directly, that is the **LISA MCP
server** — see the banner at the top.

## Wire it up (Joule Studio, CAP, SAP Build)

1. **Import the OpenAPI spec** [`api/zi18n_service.openapi.yaml`](../../api/zi18n_service.openapi.yaml)
   to create the action; the operation descriptions double as the tool prompts.
2. **Bind the action to the destination** above — that is where auth lives.
3. The BTP runtime issues the POSTs; you supply only the **JSON body**. No `Authorization` header,
   no `.env`, no secret anywhere in the skill or the agent.

CAP: consume the same destination via the SAP Cloud SDK (`executeHttpRequest`). SAP Build: an
Action bound to the destination. The wire contract is identical whichever runtime you use.

## Workflow (the JSON, whatever the runtime)

1. **Probe first** — `capabilities` (body `{}`) returns the per-action allow-list of
   `target_type`s for THIS system; public cloud and on-premise differ. Never assume a type works
   (an unlisted one fails with `CLOUD_UNSUPPORTED` or an XCO error).
2. **Read before writing** — `list_texts` returns every slot with a `populated` flag
   (`false` = still to translate):
   `{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR"}`
3. **Write with a transport** — `set_translation` needs a modifiable transport request the
   propagated user can record into:
   `{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR","transport":"A4HK900123","texts":[{"attribute":"short_field_label","value":"Client"}]}`

## Pitfalls (the ones that actually bite)

- **`cds_entity` does NOT exist here.** It is a virtual target the LISA MCP server fans out; the
  ABAP API only knows the physical `data_definition` (view) and `metadata_extension` (DDLX) —
  address them separately and merge yourself if needed.
- **HTTP status is not the whole truth**: a 200 always carries `"success": true`; business errors
  come back as HTTP 400 with `error.code`/`error.message`. A `401`/`403` means the **destination's
  auth or the SAP-side user mapping** is wrong (not a credential you hold); `404` or an HTML page =
  wrong path or service not published.
- **Positional attributes** round-trip as `"attribute": "ui_lineitem_label[3]"` in `list_texts`
  output but are written back as bare `attribute` + a separate `position` (see reference.md).
- **One call per object for writes**: batch all `texts` entries of one object into a single
  `set_translation` (entries may carry their own `field_name`/`position`) — the handler groups by
  field and locks/enqueues the object once, avoiding lock collisions.
- **Language codes are ISO** (`FR`, `RO`, `ZH`) — the handler resolves them to SAP's 1-char SPRAS
  internally; never pass SPRAS values.
