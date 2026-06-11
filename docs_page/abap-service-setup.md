# ABAP service setup

The MCP server cannot translate anything on its own — it forwards requests to an ABAP HTTP handler that uses the **XCO i18n** APIs. This page covers importing that handler and exposing it in SICF.

> The ABAP sources live in [`abap/`](../abap). See [`abap/README.md`](../abap/README.md) for a condensed version of these steps.

## Prerequisites

- **XCO i18n APIs** available — S/4HANA 2022+ / ABAP Platform 2022+ / ABAP Cloud. Older releases do not have the `XCO_CP_I18N` generation APIs this handler relies on.
- The **`IF_HTTP_SERVICE_EXTENSION`** programming model (ABAP Platform 1809 / 7.53+).
- Developer authorization (create class/interface, create SICF node).
- A target package (any Z/local package works).

## Objects to import

Import in dependency order:

| # | Object | File | Why |
|---|--------|------|-----|
| 1 | `ZIF_VSP_SERVICE` (interface) | `abap/zif_vsp_service.intf.abap` | Defines `ty_response` used by the utils class. |
| 2 | `ZCL_VSP_UTILS` (class) | `abap/zcl_vsp_utils.clas.abap` | JSON helpers + `extract_param`. |
| 3 | `ZCL_I18N_SERVICE` (class) | `abap/zcl_i18n_service.clas.abap` | The HTTP handler. |

### abapGit (recommended)

The files use abapGit source-format names (`*.intf.abap`, `*.clas.abap`). Link a package to a repo containing the `abap/` folder and pull, or use "import file" object-by-object.

### Manual (ADT or SE24/SE80)

1. Create interface `ZIF_VSP_SERVICE` → paste source → activate.
2. Create class `ZCL_VSP_UTILS` → paste source → activate.
3. Create class `ZCL_I18N_SERVICE` → paste source → activate.

Assign all three to a transportable package if you intend to move them to QA/Prod.

## Register the SICF service

The handler determines the **action** from the last path segment, so it must sit at a fixed path. The default the MCP expects is `/sap/bc/http/sap/zi18n_service`.

1. Transaction **SICF**.
2. Navigate to `default_host → sap → bc → http → sap`.
3. Create a new sub-service node named **`zi18n_service`**.
4. Assign **`ZCL_I18N_SERVICE`** as the handler class for the node.
5. Set the logon procedure to your standard (e.g. required logon / SSO) — the MCP server supplies credentials (BasicAuth locally, principal propagation on BTP).
6. **Activate** the service node.

The full external path is then `https://<host>/sap/bc/http/sap/zi18n_service`.

> Choosing a different path? Set `SAP_I18N_SERVICE_PATH` (env / `.env`) — or the `SAP_I18N_SERVICE_PATH` property in `mta.yaml` for BTP — to the exact path.

## How routing works

```
POST  …/zi18n_service/list_languages        ← action = "list_languages"
POST  …/zi18n_service/get_translation        ← action = "get_translation"
POST  …/zi18n_service/set_translation        ← action = "set_translation"
POST  …/zi18n_service/list_texts             ← action = "list_texts"
POST  …/zi18n_service/compare_translations   ← action = "compare_translations"
```

- The action is the **last URL path segment**, lowercase. `?action=…` query parameters are **ignored**.
- All parameters travel in the **JSON request body**.
- `sap-client` stays a query parameter (consumed by the ICF framework, not the handler).
- Unknown actions return `{ "success": false, "error": { "code": "UNKNOWN_ACTION", … } }` with HTTP 400.

## Verify

```bash
curl -u USER:PASS -H 'Content-Type: application/json' \
  -X POST 'https://<host>/sap/bc/http/sap/zi18n_service/list_languages?sap-client=100' \
  -d '{}'
```

Expect:

```json
{ "success": true, "data": { "languages": [ { "sap_code": "E", "iso_code": "EN", "name": "English" }, … ] } }
```

If you get HTML or a 404, the SICF node is not active or the path is wrong. If you get a 401, check the logon procedure / credentials.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| HTML login page / 404 | SICF node not activated, or wrong path. |
| 401 Unauthorized | Logon procedure vs. supplied credentials mismatch. |
| `UNKNOWN_ACTION` | Path segment misspelled, or a trailing slash dropped the action. |
| `I18N_GET_ERROR` / `I18N_SET_ERROR` | XCO i18n call failed — object doesn't exist, language not installed, or no translation authorization for the user. |
| Activation error on `ZCL_VSP_UTILS` | `ZIF_VSP_SERVICE` not imported/activated first. |
