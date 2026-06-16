# ABAP service — `zi18n_service`

These are the ABAP objects you import into the **target SAP system** so that `LISA` (the MCP server) has something to call. The MCP server never talks to ADT directly for translations — it POSTs JSON to this handler, which does the work via the **XCO i18n** APIs.

## Objects — pick **one** class

Each handler class is **fully self-contained** (the JSON/parameter helpers are inlined), so you import exactly **one** file — there are no shared dependencies to import alongside it.

| File | Object | Use when |
|------|--------|----------|
| `zcl_i18n_service.clas.abap` | `ZCL_I18N_SERVICE` | Classic ABAP stack (on-premise S/4HANA 2022+ / ABAP Platform). |
| `zcl_i18n_service_cloud.clas.abap` | `ZCL_I18N_SERVICE_CLOUD` | ABAP Cloud (Steampunk / ABAP Environment) — Cloud-API-compliant variant. |

Both implement `IF_HTTP_SERVICE_EXTENSION`, route actions from the URL path, and call the XCO i18n APIs. Same wire contract (see below) — just copy-paste the file that matches your stack.

## Requirements

- **XCO i18n APIs** present — S/4HANA 2022+ / ABAP Platform 2022+ / ABAP Cloud.
- New HTTP handler model (`IF_HTTP_SERVICE_EXTENSION`).
- A package to hold the objects (the originals live in `ZBC_TOOLS` / `$ZADT_VSP`; any Z/local package works).

## Install

### Option A — abapGit (recommended)

These files use the **source-format** naming abapGit understands (`*.clas.abap`). Drop the one class for your stack into an abapGit-linked package and pull.

### Option B — manual (ADT / SE24 / SE80)

1. Create the class for your stack (`ZCL_I18N_SERVICE` or `ZCL_I18N_SERVICE_CLOUD`), paste the source, activate. That's it — nothing else to import.

## Expose it as an HTTP service

This is an ABAP **HTTP service** (`IF_HTTP_SERVICE_EXTENSION`), **not** a hand-made SICF node. On S/4HANA 2022+ you create it in ADT and enable it in `UCON_HTTP_SERVICES` — no ICF node is created. The handler reads the **action from the last segment of the URL path** (e.g. `…/zi18n_service/list_languages`) and all parameters from the **JSON request body**.

1. In ADT: **New ▸ Other ABAP Repository Object ▸ HTTP service**. Give it a package/name/description.
2. Set its **Handler class** to the class for your stack — **`ZCL_I18N_SERVICE`** (classic) or **`ZCL_I18N_SERVICE_CLOUD`** (ABAP Cloud) — letting the wizard generate the class, then paste in the implementation (see "Manual" above).
3. **Enable** it:
   - On-premise **S/4HANA 2022+** → transaction **`UCON_HTTP_SERVICES`** → find the service → **Enable** (disabled by default → HTTP 403 until enabled).
   - On-premise **pre-2022** → activate the generated node in **SICF**.
   - **ABAP Cloud** → assign the service to a communication scenario (activates automatically).
   - After an abapGit import → click **Publish Locally** in the HTTP service editor.
4. Note the service URL and set the MCP server's `SAP_I18N_SERVICE_PATH` (or the `mta.yaml` property) to match — default `/sap/bc/http/sap/zi18n_service`.

👉 Full walkthrough: [`docs_page/abap-service-setup.md`](../docs_page/abap-service-setup.md).

## Wire contract (for reference / testing)

Every action is a **POST** to `{path}/{action}` with a JSON body. Responses are always wrapped:

```jsonc
// success
{ "success": true,  "data": { /* … */ } }
// error (HTTP 400)
{ "success": false, "error": { "code": "…", "message": "…" } }
```

| Action | Body | `data` shape |
|--------|------|--------------|
| `list_languages` | `{}` | `{ languages: [{ sap_code, iso_code, name }] }` |
| `list_texts` | `{ target_type, object_name, language? }` | `{ …, texts: [{ level, field_name, attribute, value, populated }] }` (positional UI labels encode the slot as `attribute: "name[n]"`; `populated = value non-empty`) |
| `get_translation` | `{ target_type, object_name, language, …selectors }` | `{ …, texts: [{ attribute, value }] }` |
| `set_translation` | `{ …, transport, texts: [{ attribute, value, field_name?, position? }], …selectors }` | `{ …, transport, success }` |
| `compare_translations` | `{ target_type, object_name, source_language, target_language }` | `{ …, items: [{ field_or_key, source_texts, target_texts, has_difference }] }` |

Optional selectors (only the ones relevant to a `target_type` are read): `field_name`, `fixed_value` (domain), `message_number` (message_class), `text_symbol_id` + `text_pool_owner_type` (text_pool), `subobject_name`, `position` (metadata_extension).

For `set_translation`, each `texts` entry may additionally carry its own `field_name`/`position`, overriding the top-level selectors for that entry. This lets one call write several fields of the same `data_definition`/`metadata_extension` (e.g. every `ui_lineitem_label`): the handler groups entries by field and writes each under a single transport change scenario, so the object is locked only once.

### Quick smoke test

```bash
curl -u USER:PASS \
  -H 'Content-Type: application/json' \
  -X POST 'https://your-system/sap/bc/http/sap/zi18n_service/list_languages?sap-client=100' \
  -d '{}'
```

A `{ "success": true, "data": { "languages": [...] } }` response means the service is live.
