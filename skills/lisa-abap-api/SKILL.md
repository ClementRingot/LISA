---
name: lisa-abap-api
description: >-
  Use LISA's ZCL_I18N_SERVICE ABAP HTTP API to read, write and compare SAP object translations —
  data elements, domains, CDS views, message classes, text pools, text tables, and more. Covers
  the six actions, the JSON wire contract, target types and selectors, and the pitfalls. Auth is
  handled OUTSIDE this skill — by a BTP destination or the LISA MCP server — so the agent never
  holds a credential. Use when driving zi18n_service from a BTP runtime (Joule Studio, CAP, SAP
  Build) or any client that already carries the auth; for destination setup see the BTP
  destination doc, and for a credential-holding runtime use the MCP server.
---

# LISA ABAP API — using `zi18n_service`

`ZCL_I18N_SERVICE` (`zi18n_service`) is one ABAP **HTTP service**. Every action is a **POST** of a
JSON body to `{base}{path}/{action}`, with a single response envelope:

```jsonc
{ "success": true,  "data": { … } }            // HTTP 200
{ "success": false, "error": { "code": "…", "message": "…" } }   // HTTP 400
```

Default path `/sap/bc/http/sap/zi18n_service`. Actions: `capabilities`, `list_languages`,
`list_texts`, `get_translation`, `set_translation`, `compare_translations`. Full request/response
shapes, selectors and error codes are in [reference.md](./reference.md); the machine-readable
contract is [`api/zi18n_service.openapi.yaml`](../../api/zi18n_service.openapi.yaml).

## Authentication is out of scope — on purpose

This skill **never handles a credential.** Something else carries the auth, and the agent only ever
sends a JSON body:

- **From a BTP runtime** (Joule Studio action, CAP, SAP Build): a **BTP destination** authenticates
  the call — bind your action to it. Creating that destination (per-user propagation or a shared
  Basic-auth user, per landscape) is documented in
  [BTP destination setup](../../docs_page/btp-destination-setup.md).
- **Want a runtime that holds credentials and exposes the three tools directly?** Run the **LISA
  MCP server** ([`@lisa-mcp/server`](https://www.npmjs.com/package/@lisa-mcp/server)) or the ARC-1
  extension — the agent calls the tools and never sees a secret.

**Never** build a `curl -u user:pass`, read a credential from a `.env`, or put a secret in a
prompt. If you have no authenticated way to reach the system, stop and point the user at the two
options above — do not improvise auth.

## Workflow (pure JSON, whatever the runtime)

1. **Probe first** — `capabilities` (body `{}`) returns the per-action allow-list of `target_type`s
   for THIS system; public cloud and on-premise support different sets. Never assume a type works
   (an unlisted one fails with `CLOUD_UNSUPPORTED` or an XCO error).
2. **Read before writing** — `list_texts` returns every slot with a `populated` flag
   (`false` = still to translate):
   `{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR"}`
3. **Write with a transport** — `set_translation` needs a modifiable **transport request** the
   caller's user can record into:
   `{"target_type":"data_element","object_name":"ZMY_DTEL","language":"FR","transport":"A4HK900123","texts":[{"attribute":"short_field_label","value":"Client"}]}`

## Pitfalls (the ones that actually bite)

- **`cds_entity` does NOT exist here.** It is a virtual target the LISA MCP server fans out; the
  ABAP API only knows the physical `data_definition` (view) and `metadata_extension` (DDLX) —
  address them separately and merge yourself if needed.
- **HTTP status is not the whole truth**: a 200 always carries `"success": true`; business errors
  come back as HTTP 400 with `error.code`/`error.message`. A `401`/`403` means the **auth carried
  by your destination/client** (or the SAP-side user mapping) is wrong — not something this skill
  fixes; `404` or an HTML page = wrong path or service not published.
- **Positional attributes** round-trip as `"attribute": "ui_lineitem_label[3]"` in `list_texts`
  output but are written back as bare `attribute` + a separate `position` (see reference.md).
- **One call per object for writes**: batch all `texts` entries of one object into a single
  `set_translation` (entries may carry their own `field_name`/`position`) — the handler groups by
  field and locks/enqueues the object once, avoiding lock collisions.
- **Language codes are ISO** (`FR`, `RO`, `ZH`) — the handler resolves them to SAP's 1-char SPRAS
  internally; never pass SPRAS values.
