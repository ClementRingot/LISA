---
name: zi18n-service-api
description: How to call LISA's ABAP translation backend (zi18n_service) directly over HTTP/JSON, bypassing the MCP server. Use when someone wants to script translation reads/writes with curl/Postman/any HTTP client, debug what the MCP forwards to SAP, or integrate the i18n service without MCP. Covers routes, URL, auth, request bodies, response shapes, per-target_type parameters, error codes, and the differences from the MCP tool surface.
---

# Calling the `zi18n_service` API directly (without MCP)

**Yes — you can call the translation API directly.** LISA's MCP server is a thin proxy: every MCP
tool call is forwarded as a plain `POST` of JSON to an **ABAP HTTP service** (handler class
`ZCL_I18N_SERVICE`) that does the real work via SAP's XCO i18n APIs. That HTTP service is a normal
HTTP/JSON endpoint — `curl`, Postman, or any HTTP client can call it with no MCP involved.

## Two layers — know which one you're hitting

| Layer | Endpoint | Protocol | Directly callable? |
|-------|----------|----------|--------------------|
| **LISA MCP server** | `https://lisa-<space>.<domain>/mcp` | MCP (JSON-RPC over HTTP-streamable) + XSUAA OAuth | Not a plain REST API — it speaks the MCP protocol and requires the OAuth/DCR handshake. |
| **ABAP `zi18n_service`** | `https://<sap-host>/sap/bc/http/sap/zi18n_service/<action>` | **HTTP + JSON** | **Yes — this is the one you call directly.** |

This skill documents the **ABAP `zi18n_service`** layer. When you call it directly you talk to SAP
yourself, so **you bring your own auth** (the MCP/Destination layer exists precisely to mint per-user
tokens — see [Auth](#authentication)).

---

## Base URL

```
https://<sap-host>/sap/bc/http/sap/zi18n_service/<action>?sap-client=<nnn>
```

- The path defaults to `/sap/bc/http/sap/zi18n_service` but is configurable on the service object —
  use whatever the HTTP service editor shows in ADT (the MCP's `SAP_I18N_SERVICE_PATH` must match it).
- **`<action>` is the LAST path segment** — the handler reads it from the URL path, lowercase:
  `list_languages` · `list_texts` · `set_translation` · `capabilities`.
- **`sap-client`** travels as a **query parameter** (consumed by the ICF framework, not the handler).
  Any other query parameter is ignored — `?action=…` does **not** work; the action is the path segment.

## Conventions (all actions)

- **Always `POST`.** Even `list_languages` / `capabilities` (empty body `{}`).
- **All parameters go in the JSON request body.** The handler string-matches `"name":"value"` in the
  body; it does not read form fields or query params (except `sap-client`).
- `Content-Type: application/json`, `Accept: application/json`.
- **Every response is enveloped:**
  ```jsonc
  // success — HTTP 200
  { "success": true,  "data": { /* action-specific */ } }
  // failure — HTTP 400
  { "success": false, "error": { "code": "…", "message": "…" } }
  ```

## Authentication

The handler runs under normal ABAP auth — use whatever the SAP system accepts:

| Scenario | How to authenticate the direct call |
|----------|-------------------------------------|
| On-premise / private cloud, local testing | **HTTP Basic** with a SAP user: `curl -u USER:PASS …`. |
| BTP ABAP Environment / S/4HANA Cloud | A **Bearer token** the system accepts (`Authorization: Bearer <token>`) — e.g. an OAuth token for a technical user. The MCP normally obtains a *per-user* token via the Destination Service (`OAuth2UserTokenExchange` / `SAMLAssertion`); calling raw means you supply your own. |
| Whatever the MCP forwards | The MCP sets `Authorization` (Basic, `Bearer …`, or a `SAML2.0 …` value) plus, for SAMLAssertion, `x-sap-security-session: create`. See `packages/server/src/sap/transport.ts`. |

The service is **disabled by default** (HTTP 403) until enabled — `UCON_HTTP_SERVICES` on-premise; on
ABAP Environment it activates automatically with the HTTP Service object. See
[`docs_page/abap-service-setup.md`](../../../docs_page/abap-service-setup.md).

---

## Actions

### `list_languages` — installed languages

```
POST /sap/bc/http/sap/zi18n_service/list_languages
body: {}
```

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://<host>/sap/bc/http/sap/zi18n_service/list_languages?sap-client=100' \
  -d '{}'
```

```jsonc
{ "success": true, "data": { "languages": [
  { "sap_code": "E", "iso_code": "EN", "name": "English" },
  { "sap_code": "D", "iso_code": "DE", "name": "German" }
] } }
```

`sap_code` = SAP `SPRAS` (1 char); `iso_code` = ISO 639-1.

### `capabilities` — which `target_type`s this stack supports

```
POST /sap/bc/http/sap/zi18n_service/capabilities
body: {}
```

```jsonc
{ "success": true, "data": {
  "list_texts":      ["data_element", "domain", "data_definition", "metadata_extension", "message_class", "text_table", …],
  "set_translation": ["data_element", "domain", "data_definition", "metadata_extension", "message_class", "text_pool", "text_table", …]
} }
```

An **allow-list per action**: the object types this handler can serve. Public cloud / BTP ABAP
Environment and on-premise support **different** sets, and it can differ by system version (e.g.
`text_pool` is writable but not listable on the cloud stack). Calling a `(action, target_type)` not on
the list returns the `CLOUD_UNSUPPORTED` error. Older handlers may not implement this action
(`UNKNOWN_ACTION` / 404) — then there is no allow-list and you rely on the per-call backstop.

### `list_texts` — read every translatable text of one object

```
POST /sap/bc/http/sap/zi18n_service/list_texts
body: { target_type, object_name, language?, <selectors…> }
```

- `language` is **optional**: omit it to read in the object's **original** language; the response
  echoes the effective `language` back.
- Add the **selectors required by your `target_type`** (see the [reference table](#target_type-reference)).

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://<host>/sap/bc/http/sap/zi18n_service/list_texts?sap-client=100' \
  -d '{ "target_type": "data_element", "object_name": "ZE_CUSTOMER_NAME", "language": "DE" }'
```

```jsonc
{ "success": true, "data": {
  "target_type": "data_element",
  "object_name": "ZE_CUSTOMER_NAME",
  "language": "DE",
  "texts": [
    { "level": "field", "field_name": "", "attribute": "short_field_label",  "value": "Kundenname", "populated": true },
    { "level": "field", "field_name": "", "attribute": "medium_field_label", "value": "",           "populated": false }
  ]
} }
```

Per entry: `level` (`entity|field|fixed_value|message|text_symbol`), `field_name` (empty for
entity-level), `attribute`, `value`, and **`populated`** (`false` = slot exists but is empty in this
language, i.e. *still to translate*). Positional UI labels come back with the index **baked into the
attribute** as `name[n]` (e.g. `ui_lineitem_label[1]`) — see [Positional labels](#positional-ui-labels).

### `set_translation` — write/update translations

```
POST /sap/bc/http/sap/zi18n_service/set_translation
body: {
  target_type, object_name, language, transport,
  texts: [ { attribute, value, field_name?, position? }, … ],
  <selectors…>
}
```

- **`transport`** (e.g. `K900001`) is **required** — the change is recorded on it. A `set_translation`
  always runs under a transport change scenario.
- `texts[].field_name` / `texts[].position` are **per-entry overrides** of the top-level selectors, so
  one call can write several fields of the same object (it's locked once). Send `position` as a
  **string**, and `attribute` **bare** (`"ui_lineitem_label"` + `"position": "2"`).

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://<host>/sap/bc/http/sap/zi18n_service/set_translation?sap-client=100' \
  -d '{
        "target_type": "data_element",
        "object_name": "ZE_CUSTOMER_NAME",
        "language": "DE",
        "transport": "K900001",
        "texts": [
          { "attribute": "short_field_label",  "value": "Kundenname" },
          { "attribute": "medium_field_label", "value": "Name des Kunden" }
        ]
      }'
```

```jsonc
{ "success": true, "data": {
  "target_type": "data_element", "object_name": "ZE_CUSTOMER_NAME",
  "language": "DE", "transport": "K900001", "success": true
} }
```

---

## `target_type` reference

`target_type` values are **XCO semantic kinds**, not DDIC codes (`data_element`, not `DTEL`).
Send the selectors marked **required**; the rest are ignored for that type.

| `target_type` | What it is | Required selectors (in `body`) | Typical `attribute` values |
|---------------|-----------|--------------------------------|----------------------------|
| `data_element` | DTEL field labels | — | `short_field_label`, `medium_field_label`, `long_field_label`, `heading_field_label` |
| `domain` | DOMA fixed-value texts | `fixed_value` (the lower limit) | `fixed_value_description` |
| `data_definition` | CDS view/DDLS labels | — (`field_name` to scope one field) | `endusertext_label`, `ui_lineitem_label`, `ui_facet_label`, … |
| `metadata_extension` | DDLX (CDS UI annotations) | — (`field_name`, `position` to scope) | `endusertext_label`, `ui_lineitem_label`, … |
| `message_class` | MSAG message texts | `message_number` | `message_short_text` |
| `text_pool` | class / function-group text symbols | `text_symbol_id`; `text_pool_owner_type` = `class` (default) or `function_group` | the symbol text |
| `application_log_object` | APLO | `subobject_name` (for the sub-object) | object/sub-object text |
| `business_configuration_object` | SMBC | — | object text |
| `text_table` | a text table (delivery class C/S, one LANG key field, e.g. `T005T`) | `language_key_field_name` (the LANG field, e.g. `SPRAS`) **and** `master_key_fields` (`[{name,value}]` pinning every master key except the language) | a text **column** name, e.g. `LANDX` |

`language` accepts ISO 639-1 (`EN`,`DE`,`FR`) **or** the SAP `SPRAS` single char (`E`,`D`,`F`).

### `text_table` example

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://<host>/sap/bc/http/sap/zi18n_service/set_translation?sap-client=100' \
  -d '{
        "target_type": "text_table", "object_name": "T005T",
        "language": "DE", "transport": "K900001",
        "language_key_field_name": "SPRAS",
        "master_key_fields": [ { "name": "LAND1", "value": "DE" } ],
        "texts": [ { "attribute": "LANDX", "value": "Deutschland" } ]
      }'
```

---

## Differences from the MCP tool surface (read before scripting)

The MCP tools (`TranslateListLanguages` → `list_languages`, `TranslateGetTexts` → `list_texts`,
`TranslateSetTexts` → `set_translation`) add **client-side logic in `@lisa/core` that the raw backend
does NOT do**. If you bypass MCP you must replicate it yourself:

1. **`cds_entity` is virtual — it does NOT exist on the backend.** The MCP exposes a convenience
   `target_type: "cds_entity"` that fans out to the **two real** targets `data_definition` (the
   view/DDLS) and `metadata_extension` (its DDLX), merges the reads, and routes each write back by a
   per-row `owner`. The raw API only knows `data_definition` and `metadata_extension`. To do the
   `cds_entity` thing directly: call `list_texts` for **both** and concatenate; on write, split your
   rows by which physical object they belong to and issue **two** `set_translation` calls. There is no
   `owner` field on the wire — it's a LISA routing key only.

2. **Positional UI labels.** <a id="positional-ui-labels"></a> `list_texts` returns repeatable
   annotations with the index in the attribute (`ui_lineitem_label[1]`). For `set_translation` the
   backend wants the **bare** `attribute` plus a **separate** `position` string
   (`{ "attribute": "ui_lineitem_label", "position": "1" }`). So when round-tripping a raw read into a
   raw write, split `name[n]` → (`name`, `n`) yourself. (The MCP does this split/merge for you.)

3. **Capabilities pre-check.** The MCP fetches `capabilities` once and **rejects an unsupported
   `(action, target_type)` up-front**. Raw, you'll instead get a `CLOUD_UNSUPPORTED` error back from
   SAP after the round-trip. Call `capabilities` first if you want to pre-validate.

4. **Filtering by `field_name` / `position` on read.** `list_texts` always returns **every** slot of
   the object. The MCP narrows the result client-side when you pass `field_name`/`position`; raw, you
   get the full list and filter yourself.

5. **Envelope unwrap & error mapping.** The MCP unwraps `{success,data}` and turns `error.code` into a
   message (and rephrases `CLOUD_UNSUPPORTED`). Raw, you read the envelope yourself: treat
   `success:false` **or** non-2xx HTTP as failure.

## Error codes

Failures return HTTP 400 with `{ "success": false, "error": { "code", "message" } }`. Common codes:

| Code | Meaning |
|------|---------|
| `UNKNOWN_ACTION` | Path segment misspelled / trailing slash dropped the action, or the handler predates that action. |
| `CLOUD_UNSUPPORTED` | The object type/operation isn't available on the ABAP Cloud (public cloud / BTP ABAP Environment) stack. Check `capabilities`. |
| `I18N_GET_ERROR` | A `list_texts` read failed — object doesn't exist, language not installed, or no authorization. |
| `I18N_SET_ERROR` | A `set_translation` write failed — bad transport, locked object, missing authorization, or invalid selector. |

Transport-level (not enveloped): **403** = service not enabled / not published; **404** / HTML =
wrong path or unpublished; **401** = credentials rejected.

## Source of truth

The exact, code-level contract lives in [`packages/core/src/wire.ts`](../../../packages/core/src/wire.ts)
(request/response types, envelope, normalization) and
[`packages/core/src/schemas.ts`](../../../packages/core/src/schemas.ts) (`target_type` enum, selectors,
attribute names). The handler that implements it is `abap/<platform>/zcl_i18n_service.clas.abap`. The
wire contract is additive/stable — see
[`docs_page/wire-contract-evolution.md`](../../../docs_page/wire-contract-evolution.md). A condensed
version with more examples is in [`abap/README.md`](../../../abap/README.md) and
[`docs_page/text-table.md`](../../../docs_page/text-table.md).
