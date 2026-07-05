# LISA ABAP API — wire contract reference

Every action: `POST {base}{path}/{action}` with a JSON body (`Content-Type: application/json`),
Basic Auth, `?sap-client=NNN` on-premise only. Envelope: `{ "success": true, "data": {…} }` on
200, `{ "success": false, "error": { "code", "message" } }` on 400.

## Actions

### `capabilities` — probe what THIS system supports (call first)

Request: `{}`
Response `data`:

```jsonc
{ "list_texts":      ["data_element", "domain", "data_definition", "…"],
  "set_translation": ["data_element", "domain", "text_pool", "…"] }
```

Per-action **allow-lists** of `target_type`s. They differ between public cloud and
on-premise/private cloud, and can differ by system version (e.g. `text_pool` may be writable but
not listable on the cloud stack). A `target_type` absent from the relevant list will be rejected.
Older handlers without this action return 404 for it — then be prepared for `CLOUD_UNSUPPORTED`
errors at call time instead.

### `list_languages`

Request: `{}` → `data.languages`: `[{ "sap_code": "F", "iso_code": "FR", "name": "French" }, …]`

### `list_texts` — whole-object read (the workhorse)

Request:

```jsonc
{ "target_type": "data_definition", "object_name": "ZI_MYVIEW", "language": "FR" }
// "language" optional — omitted: reads the object's ORIGINAL language (returned in the response)
```

Response `data.texts[]`: `{ "level", "field_name", "attribute", "value", "populated" }`

- `populated: false` = the slot exists but is empty in that language (still to translate)
- Positional UI labels are encoded in the attribute: `"attribute": "ui_lineitem_label[3]"`
- "List translated only" = filter `populated === true`; "compare" = two calls diffed on
  `(field_name, attribute, populated, value)`

### `get_translation` — targeted read (one selector scope)

Request: `{ "target_type", "object_name", "language", …selectors }` →
`data.texts[]`: `{ "attribute", "value" }`

### `set_translation` — write (transport required)

Request:

```jsonc
{ "target_type": "metadata_extension",
  "object_name": "ZC_MYVIEW",
  "language": "FR",
  "transport": "A4HK900123",
  "texts": [
    { "attribute": "ui_lineitem_label", "position": 1, "field_name": "CUSTOMER", "value": "Client" },
    { "attribute": "ui_lineitem_label", "position": 2, "field_name": "AMOUNT",   "value": "Montant" }
  ],
  …top-level selectors }
```

Response `data`: `{ …, "transport": "A4HK900123", "success": true }`

- Each `texts` entry may carry its own `field_name`/`position`, **overriding** the top-level
  selectors for that entry → write every field of one object in ONE call; the handler groups
  entries by field and enqueues/locks the object once.
- Positional attributes are written as **bare** `attribute` + numeric `position` (1-based) —
  not the `name[n]` form that `list_texts` outputs. The index is never renumbered.

### `compare_translations`

Request: `{ "target_type", "object_name", "source_language", "target_language" }` →
`data.items[]`: `{ "field_or_key", "source_texts", "target_texts", "has_difference" }`

## `target_type` catalog and selectors

Only the types returned by `capabilities` are valid on a given system.

| `target_type` | SAP object | Typical attributes | Extra selectors |
|---|---|---|---|
| `data_element` | DTEL | `short_field_label`, `medium_field_label`, `long_field_label`, `heading_field_label` | — |
| `domain` | DOMA fixed values | `fixed_value_description` | `fixed_value` |
| `data_definition` | CDS view (DDLS) | `endusertext_label`, positional `ui_*` labels | `field_name`, `position` |
| `metadata_extension` | DDLX UI labels | `endusertext_label`, positional `ui_*` labels | `field_name`, `subobject_name`, `position` |
| `message_class` | MSAG | `message_short_text` | `message_number` |
| `text_pool` | Class / function-group text symbols | text symbol values | `text_symbol_id`, `text_pool_owner_type` |
| `application_log_object` | APLO | object / sub-object texts | `subobject_name` |
| `business_configuration_object` | SMBC | description texts | — |
| `text_table` | Delivery-class C/S table with ONE language key field (e.g. `T005T`) | its non-key character columns (e.g. `LANDX`) | `language_key_field_name`, `master_key_fields` |

**`text_table` specifics** — two mandatory extras:

```jsonc
{ "target_type": "text_table", "object_name": "T005T", "language": "FR",
  "language_key_field_name": "SPRAS",
  "master_key_fields": [ { "name": "LAND1", "value": "DE" } ],   // ALL keys except the language field
  "transport": "…", "texts": [ { "attribute": "LANDX", "value": "Allemagne" } ] }
```

On write, `attribute` is a **text column name**, not a UI label. A table without a language key
field (e.g. delivery class W) is rejected by XCO.

**No `cds_entity` here.** That merged view+DDLX target exists only in the LISA MCP server, which
fans it out to `data_definition` + `metadata_extension`. Direct callers do the same: read both,
tag rows yourself, write each object with its own `set_translation` call (each gets its own
lock/transport recording; writes across the two objects are not atomic).

## Errors

| Signal | Meaning / fix |
|---|---|
| HTTP 200, `success: true` | OK |
| HTTP 400, `error.code` `CLOUD_UNSUPPORTED` | `target_type` not supported on this stack for this action — re-check `capabilities` |
| HTTP 400, other `error.code` | Business error from XCO/handler — `error.message` is specific (missing transport, object not found, bad selector, unresolvable language…) |
| HTTP 401 | Basic-auth credentials rejected |
| HTTP 403 | Service not enabled (`UCON_HTTP_SERVICES` on-premise) or the user lacks the service authorization (cloud: check the communication arrangement) |
| HTTP 404 / HTML | Wrong path, service not published, or (for `capabilities` only) an older handler |

## Full smoke test

```bash
BASE="https://your-system.example.com"; P="/sap/bc/http/sap/zi18n_service"
AUTH="USER:PASS"; CLIENT="?sap-client=100"   # CLIENT="" on cloud

curl -u "$AUTH" -H 'Content-Type: application/json' -X POST "$BASE$P/list_languages$CLIENT" -d '{}'
# → {"success":true,"data":{"languages":[…]}}  = service live, auth OK
```
