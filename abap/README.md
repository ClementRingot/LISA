# ABAP service — `zi18n_service`

These are the ABAP objects you import into the **target SAP system** so that `LISA` (the MCP server) has something to call. The MCP server never talks to ADT directly for translations — it POSTs JSON to this handler, which does the work via the **XCO i18n** APIs.

## Objects — pick **one** class for your platform

The handler class ships in **three platform variants**, one per folder. Pick the folder that matches your stack and import the class it contains — all three speak the **same wire contract** and only differ in the XCO i18n API surface available on that release:

| Folder | Class | Use when |
|--------|-------|----------|
| [`ABAP_PLATFORM_2022/`](./ABAP_PLATFORM_2022) | `ZCL_I18N_SERVICE` | On-premise / private cloud on **ABAP Platform 2022 (7.57)** — the original XCO i18n surface (e.g. `iv_language_field_name` for text tables). |
| [`ABAP_PLATFORM_2025/`](./ABAP_PLATFORM_2025) | `ZCL_I18N_SERVICE` | On-premise / private cloud on **ABAP Platform 2025** (newer releases) — the newer XCO i18n surface (`iv_language_key_field_name`, positional entity texts, Fiori launchpad page/space targets). |
| [`CLOUD/`](./CLOUD) | `ZCL_I18N_SERVICE_CLOUD` | **SAP BTP ABAP Environment / public cloud** (Steampunk) — Cloud-API-compliant variant. |

Each handler class is **self-contained** (the JSON/parameter helpers are inlined) with **no global dependencies** to import alongside it. It does, however, use one **local class** (`lcl_slot_visitor`, an XCO CDS-annotation visitor that collects positional UI labels), which lives in the class's local-types includes — so each class object spans the main source **plus two local-types files**:

| File | abapGit include | ADT section |
|------|-----------------|-------------|
| `*.clas.abap` | main | Global Class |
| `*.clas.locals_def.abap` | CCDEF | Class-relevant Local Types |
| `*.clas.locals_imp.abap` | CCIMP | Local Types |

All three files of the folder you picked deserialize as the **single** CLAS object — there is nothing else to import.

All variants implement `IF_HTTP_SERVICE_EXTENSION`, route actions from the URL path, and call the XCO i18n APIs. Same wire contract (see below) — just copy-paste the files from the folder that matches your platform.

> **This `abap/` tree is reference source — import ONE folder, do not clone it whole.** It is **not** a single abapGit-clonable package: the two on-premise folders both contain a class named `ZCL_I18N_SERVICE`, so linking the whole `abap/` tree (or its parent repo) to one package would collide on that object name. There is deliberately no `.abapgit.xml`. Point abapGit (or a manual copy) at the **one** platform folder you need, into its own package.

> **Keep the three variants in sync on shared logic.** Each class is self-contained (helpers inlined, no shared includes), so the JSON/parameter helpers, `capabilities` allow-list, and other common code are **duplicated** across the three files. A fix to that shared logic must be applied in **all three** (`ABAP_PLATFORM_2022/`, `ABAP_PLATFORM_2025/`, `CLOUD/`) — they only legitimately differ in the XCO i18n API surface per release.

> **Planning a bigger change?** For why the split exists, the compilation wall behind it, and how to grow the wire contract / add a `target_type` or parameter as the XCO APIs diverge — without forking the MCP — see [`docs_page/wire-contract-evolution.md`](../docs_page/wire-contract-evolution.md).

## Requirements

- **XCO i18n APIs** present — S/4HANA - Public cloud / BTP ABAP Environment / S/4HANA 2022+ - ABAP Platform.
- New HTTP handler model (`IF_HTTP_SERVICE_EXTENSION`).
- A package to hold the objects.

## Install

### Option A — abapGit (recommended)

These files use the **source-format** naming abapGit understands (`*.clas.abap`, `*.clas.locals_def.abap`, `*.clas.locals_imp.abap`). Drop the three files from your platform folder (`ABAP_PLATFORM_2022/`, `ABAP_PLATFORM_2025/`, or `CLOUD/`) into an abapGit-linked package and pull — abapGit reassembles them into the one class.

### Option B — manual (ADT / SE24 / SE80)

1. Create the class for your stack (`ZCL_I18N_SERVICE` or `ZCL_I18N_SERVICE_CLOUD`) and paste the **three** parts into their tabs before activating:
   - `*.clas.abap` → the global class (Global Class tab)
   - `*.clas.locals_def.abap` → **Class-relevant Local Types** tab (CCDEF)
   - `*.clas.locals_imp.abap` → **Local Types** tab (CCIMP)

   Then activate. Skipping the local-types parts leaves `lcl_slot_visitor` undefined and the class won't activate.

## Expose it as an HTTP service

This is an ABAP **HTTP service** (`IF_HTTP_SERVICE_EXTENSION`), **not** a hand-made SICF node. On S/4HANA 2022+ (on-premise / private cloud) you create it in ADT and enable it in `UCON_HTTP_SERVICES` — no ICF node is created. The handler reads the **action from the last segment of the URL path** (e.g. `…/zi18n_service/list_languages`) and all parameters from the **JSON request body**.

1. In ADT: **New ▸ Other ABAP Repository Object ▸ HTTP service**. Give it a package/name/description.
2. Set its **Handler class** to the class for your stack — **`ZCL_I18N_SERVICE`** (classic) or **`ZCL_I18N_SERVICE_CLOUD`** (ABAP Cloud) — letting the wizard generate the class, then paste in the implementation (see "Manual" above).
3. **Enable** it:
   - On-premise / private cloud **S/4HANA 2022+** → transaction **`UCON_HTTP_SERVICES`** → find the service → **Enable** (disabled by default → HTTP 403 until enabled).
   - On-premise / private cloud **pre-2022** → activate the generated node in **SICF**.
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
| `set_translation` | `{ …, transport, texts: [{ attribute, value, field_name?, position? }], …selectors }` | `{ …, transport, success }` |
| `capabilities` | `{}` | `{ list_texts: [target_type…], set_translation: [target_type…] }` — an **allow-list**: each action lists the object types this stack can translate. To remove a possibility, delete the type from the relevant list in `handle_capabilities`. Public cloud / BTP ABAP Environment and on-premise / private cloud support **different** object types (e.g. `text_pool` is writable but not listable on the cloud stack, so it appears under `set_translation` but not `list_texts`). The set can also differ by **system version**. The MCP server probes this and rejects a `target_type` not on the list up-front; older handlers without the action stay permissive and rely on the `CLOUD_UNSUPPORTED` error. |

Optional selectors (only the ones relevant to a `target_type` are read): `field_name`, `fixed_value` (domain), `message_number` (message_class), `text_symbol_id` + `text_pool_owner_type` (text_pool), `subobject_name`, `position` (metadata_extension), `language_key_field_name` + `master_key_fields` (text_table).

For `target_type=text_table` (a delivery-class C/S table with one LANG key field, e.g. `T005T`), send `language_key_field_name` (the LANG key field, e.g. `SPRAS`) and `master_key_fields` (`[{ "name", "value" }]` fixing every master key except the language field) to pin one record; each `texts` entry's `attribute` is a text **column** name (e.g. `LANDX`). See [`docs_page/text-table.md`](../docs_page/text-table.md) for full request/response shapes.

For `set_translation`, each `texts` entry may additionally carry its own `field_name`/`position`, overriding the top-level selectors for that entry. This lets one call write several fields of the same `data_definition`/`metadata_extension` (e.g. every `ui_lineitem_label`): the handler groups entries by field and writes each under a single transport change scenario, so the object is locked only once.

### Quick smoke test

```bash
curl -u USER:PASS \
  -H 'Content-Type: application/json' \
  -X POST 'https://your-system/sap/bc/http/sap/zi18n_service/list_languages?sap-client=100' \
  -d '{}'
```

A `{ "success": true, "data": { "languages": [...] } }` response means the service is live.
