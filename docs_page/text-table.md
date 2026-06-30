# `text_table` — translating text tables

`text_table` is a `target_type` (not a new tool): it plugs into the three existing LISA
tools — `TranslateListLanguages`, `TranslateGetTexts`, `TranslateSetTexts` — with a couple of
extra parameters. It is served by the ABAP handler `ZCL_I18N_SERVICE` on all three stacks
(imported from `abap/ABAP_PLATFORM_2022|2025/` on classic / on-premise & private cloud, or
`abap/CLOUD/` on the BTP ABAP Environment).

## What is a *text table*?

A database table whose **delivery class is C or S** and that has **exactly one** language key
field (LANG, e.g. `SPRAS`). Its non-key character columns (other than the language field) are
the translatable **text attributes**.

Canonical example: `T005T` (country names)

- keys: `MANDT`, `SPRAS`, `LAND1`
- language field: `SPRAS`
- text columns: `LANDX` (country name), `NATIO`, …

A target record is identified by the **full specification of the master key fields** — every
key field except the language field, e.g. `LAND1 = 'DE'`.

## Parameters

In addition to `target_type`, `object_name` and `language` (and `transport` for writes):

| Parameter | Required | Description |
|---|---|---|
| `object_name` | yes | Base table name (e.g. `T005T`) |
| `language_key_field_name` | yes | The table's LANG key field (e.g. `SPRAS`) |
| `master_key_fields` | yes | `[{ "name": <key field>, "value": <value> }]` pinning the record |
| `texts` | yes (set) | `[{ "attribute": <text column>, "value": <translation> }]` |
| `language` | set: yes / get: optional | ISO (`DE`) or SAP (`D`) code. Omitted on read → connection language |
| `transport` | set: yes | Transport request (on transportable systems) |

> LISA always sends the JSON key `language_key_field_name`. The XCO parameter name differs by
> release (`iv_language_field_name` on 7.57 / ABAP Platform 2022 vs `iv_language_key_field_name`
> on newer releases); that is handled inside the per-platform handler class — LISA does not need
> to care.

## `TranslateSetTexts` — write a translation

Request:

```json
{
  "target_type": "text_table",
  "object_name": "T005T",
  "language": "DE",
  "transport": "DS1K986972",
  "language_key_field_name": "SPRAS",
  "master_key_fields": [
    { "name": "LAND1", "value": "DE" }
  ],
  "texts": [
    { "attribute": "LANDX", "value": "Deutschland" }
  ]
}
```

Response:

```json
{
  "success": true,
  "data": {
    "target_type": "text_table",
    "object_name": "T005T",
    "language": "DE",
    "transport": "DS1K986972",
    "success": true
  }
}
```

Specific errors (`MISSING_PARAM` / `INVALID_ATTRS`) when `language_key_field_name` or
`master_key_fields` are missing, or when no valid text attribute is supplied.

## `TranslateGetTexts` — read translations

The read enumerates the text columns (non-key, excluding the language field) automatically and
returns those that carry a text for the requested language. `language` may be omitted
(→ connection language).

Request:

```json
{
  "target_type": "text_table",
  "object_name": "T005T",
  "language": "EN",
  "language_key_field_name": "SPRAS",
  "master_key_fields": [
    { "name": "LAND1", "value": "DE" }
  ]
}
```

Response (one entry per filled text column):

```json
{
  "success": true,
  "data": {
    "target_type": "text_table",
    "object_name": "T005T",
    "language": "EN",
    "texts": [
      { "level": "record", "field_name": "LANDX", "attribute": "LANDX", "value": "Germany" }
    ]
  }
}
```

## `TranslateListLanguages`

Unchanged — the language list is independent of `target_type`.

## Availability per stack

| Stack | `text_table` |
|---|---|
| Classic / on-premise (full XCO, `xco_i18n=>target`) | ✅ |
| Private cloud | ✅ (same full-XCO API) |
| BTP ABAP Environment (released, `xco_cp_i18n=>target`) | ✅ |

`text_table` appears in the `capabilities` response (`list_texts` **and** `set_translation`) on
all three stacks, so LISA advertises it in the read/write tool descriptions when connected to a
backend that supports it.

## Guard-rails

- Use `text_table` only for **delivery class C/S** tables with **exactly one** language key
  field. A table with no language field (e.g. delivery class W) is rejected by XCO.
- `master_key_fields` must fix **all** master keys (every key except the language field) so a
  single record is targeted.
- `attribute` (in `texts`) is the **text column name** (e.g. `LANDX`), not a UI label.
- Always supply `transport` on a transportable system when writing.
