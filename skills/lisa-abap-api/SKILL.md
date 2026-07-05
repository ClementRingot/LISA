---
name: lisa-abap-api
description: >-
  Call LISA's ZCL_I18N_SERVICE ABAP HTTP API directly over HTTPS (no MCP server) to read, write
  and compare SAP object translations — data elements, domains, CDS views, message classes, text
  pools, text tables, and more. Use when translating SAP repository objects from scripts, CI, or
  an agent with direct network access to the SAP system and basic-auth credentials, when the LISA
  MCP server / ARC-1 extension is not deployed, or when debugging what the MCP layer sends to
  ABAP. Covers auth per landscape (technical user on-premise/private cloud; communication
  scenario + arrangement on BTP ABAP Environment / public cloud), all six actions, and the JSON
  wire contract.
---

# LISA ABAP API — direct calls (no MCP)

The whole API is **one ABAP HTTP service** (`zi18n_service`, handler class `ZCL_I18N_SERVICE`)
installed on the target SAP system. Every action is a **POST** of a JSON body to
`{base}{path}/{action}`; responses always use one envelope:

```jsonc
{ "success": true,  "data": { … } }            // HTTP 200
{ "success": false, "error": { "code": "…", "message": "…" } }   // HTTP 400
```

Default path: `/sap/bc/http/sap/zi18n_service`. Actions: `capabilities`, `list_languages`,
`list_texts`, `get_translation`, `set_translation`, `compare_translations` — full
request/response shapes, selectors and error codes are in [reference.md](./reference.md).

## Prerequisites — basic auth per landscape

Direct calls authenticate with **HTTP Basic Auth**. Who the user is differs by landscape:

| Landscape | Caller identity | One-time setup |
|---|---|---|
| **On-premise / private cloud** (S/4HANA 2022+) | A **technical user** (system/service user) with the translation authorizations | Service enabled in `UCON_HTTP_SERVICES`; append `?sap-client=NNN` to every call |
| **BTP ABAP Environment / S/4HANA Cloud public** | A **communication user** | A custom **communication scenario** (in ADT, with the `zi18n_service` HTTP service as inbound, auth = Basic) + a **communication arrangement** (Fiori: *Communication Arrangements*) that binds the scenario to a **communication system + communication user**. The arrangement's service URL/host is what you call — no `sap-client` param |

> On ABAP Environment the *endpoint itself* activates with the HTTP Service object (no
> enablement step) — the communication scenario/arrangement is what creates a **basic-auth
> identity allowed to call it from outside**. The user's SAP authorizations (not LISA) decide
> what they may read/write; writes additionally need a **transport request** the user can record
> into.

## Called from BTP (destinations — per-user propagation instead of basic auth)

When the caller runs **on BTP** (Joule Studio actions, CAP apps, SAP Build…), put the auth in a
**BTP destination** instead of hardcoding basic auth — including the per-user
principal-propagation variants, which run every call under the identity of the actual end user
(per-user SAP authorizations + clean audit, no shared technical user):

| Backend | Destination `Authentication` | SAP receives |
|---|---|---|
| On-premise / private cloud | `PrincipalPropagation` (`ProxyType=OnPremise`, Cloud Connector) | the real business user |
| BTP ABAP Env — same subaccount | `OAuth2UserTokenExchange` | per-user Bearer |
| BTP ABAP Env — cross-subaccount | `OAuth2SAMLBearerAssertion` | per-user Bearer |
| S/4HANA Cloud public | `SAMLAssertion` | per-user `SAML2.0 …` |

Three conditions for propagation to work: (1) the calling runtime must support user-propagating
destination auth types (check your Joule Studio / actions version — technical-only runtimes fall
back to a BasicAuth destination and the prerequisites above); (2) the identity trust chain
(IAS/XSUAA) between the caller's subaccount and the destination's; (3) a user mapping on the SAP
side (Cloud Connector cert mapping on-premise; a business user with matching email on cloud) —
plus, for writes, per-user transport access. Note `OAuth2UserTokenExchange` only works within
ONE subaccount, and a propagated business user on public cloud does NOT need the communication
arrangement (that exists to mint the basic-auth communication user).

For **Joule Studio** specifically: import the OpenAPI spec at
[`api/zi18n_service.openapi.yaml`](../../api/zi18n_service.openapi.yaml) to create the action,
bind it to the destination, and the action descriptions do the rest. The wire contract below is
identical either way — only who authenticates changes.

## Workflow

1. **Smoke-test + capability probe** (always start here):

```bash
BASE="https://your-system.example.com"; P="/sap/bc/http/sap/zi18n_service"
AUTH="TECH_USER:secret"        # communication user on cloud
CLIENT="?sap-client=100"       # on-premise only — drop on cloud

curl -u "$AUTH" -H 'Content-Type: application/json' -X POST "$BASE$P/capabilities$CLIENT" -d '{}'
```

`capabilities` returns the **allow-list of `target_type`s per action** for THIS system —
public cloud and on-premise support different sets. Never assume a type works: probe, then only
use listed types (calling an unlisted one fails with `CLOUD_UNSUPPORTED` or an XCO error).

2. **Read before writing** — `list_texts` returns every translatable slot of an object with a
   `populated` flag (`false` = still to translate in that language):

```bash
curl -u "$AUTH" -H 'Content-Type: application/json' -X POST "$BASE$P/list_texts$CLIENT" \
  -d '{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR"}'
```

3. **Write with a transport** — `set_translation` requires a modifiable **transport request**
   (workbench) the basic-auth user owns or can record into:

```bash
curl -u "$AUTH" -H 'Content-Type: application/json' -X POST "$BASE$P/set_translation$CLIENT" \
  -d '{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR",
       "transport":"A4HK900123",
       "texts":[{"attribute":"short_field_label","value":"Client"},
                {"attribute":"long_field_label","value":"Numéro de client"}]}'
```

## Pitfalls (the ones that actually bite)

- **`cds_entity` does NOT exist here.** It is a virtual target the LISA MCP server fans out;
  the ABAP API only knows the physical `data_definition` (view) and `metadata_extension` (DDLX)
  — call them separately and merge yourself if needed.
- **HTTP status is not the whole truth**: a 200 always carries `"success": true`; business
  errors come back as HTTP 400 with `error.code`/`error.message`. Transport-level answers:
  `401` = wrong credentials; `403` = service not enabled (`UCON_HTTP_SERVICES`) / user lacks
  the service authorization; `404` or an HTML page = wrong path or service not published.
- **Positional attributes** round-trip as `"attribute": "ui_lineitem_label[3]"` in `list_texts`
  output but are written back as bare `attribute` + separate `position` (see reference.md).
- **One call per object for writes**: batch all `texts` entries of one object into a single
  `set_translation` (entries may carry their own `field_name`/`position`) — the handler groups
  by field and locks/enqueues the object once, avoiding lock collisions.
- **Language codes are ISO** (`FR`, `RO`, `ZH`) — the handler resolves them to SAP's 1-char
  SPRAS internally; never pass SPRAS values.
