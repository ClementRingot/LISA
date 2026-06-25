# MCP tools usage

`LISA` exposes **3 tools**. Every authenticated caller sees all three. This page documents each tool's inputs and gives example calls.

> Earlier builds shipped `TranslateListTexts` and `TranslateCompare`. Both are gone — `TranslateGetTexts` is now the whole-object reader, so "list" and "compare" are done by reading (and diffing) its output. See [A typical workflow](#a-typical-workflow).

## Common concepts

### `target_type`

The kind of object to translate — an XCO **semantic literal**, not a DDIC short code:

| `target_type` | SAP object |
|---------------|-----------|
| `cds_entity` | **CDS entity — merged view (`data_definition`) + its DDLX (`metadata_extension`)** |
| `data_element` | Data element (DTEL) |
| `domain` | Domain fixed-value texts (DOMA) |
| `data_definition` | CDS view (DDLS) entity/field labels |
| `message_class` | Message class (MSAG) |
| `text_pool` | Class / function-group text symbols |
| `metadata_extension` | CDS metadata extension (DDLX) UI labels |
| `application_log_object` | Application log object (APLO) |
| `business_configuration_object` | Business configuration object (SMBC) |

> **`cds_entity` (the merged CDS surface).** A CDS entity's labels are split across two physical objects — the view itself (`data_definition`) and its metadata extension/DDLX (`metadata_extension`). `cds_entity` treats them as one: `TranslateGetTexts` fans out to **both** and concatenates the result (DDLX labels included automatically — no second call), tagging every CDS row with an **`owner`** of `"data_definition"` or `"metadata_extension"`. `TranslateSetTexts` reads that `owner` back and routes each row to the matching object, so each is locked/transported **once**. Rows are **not** deduplicated across owners. `data_definition` and `metadata_extension` stay available to target one physical object explicitly (single-owner, unmerged).

### `language`

ISO 639-1 (`EN`, `DE`, `FR`, …) or the SAP single-char SPRAS code (`E`, `D`, `F`, …).

### Selectors (optional)

Disambiguate sub-objects within a target. Only the ones relevant to a `target_type` are read; the rest are ignored:

| Selector | Used for |
|----------|----------|
| `field_name` | a single field of a `data_definition` / `metadata_extension` |
| `fixed_value` | a `domain` fixed value (lower limit) |
| `message_number` | a single message in a `message_class` |
| `text_symbol_id` + `text_pool_owner_type` (`class`/`function_group`) | a `text_pool` symbol |
| `subobject_name` | an `application_log_object` sub-object |
| `position` | a repeatable UI annotation (`metadata_extension`) |

---

## `TranslateListLanguages`

List all languages installed on the SAP system. No arguments.

```json
{ "name": "TranslateListLanguages", "arguments": {} }
```

Returns `[{ sap_code, iso_code, name }, …]`.

---

## `TranslateGetTexts`

Read **all** translatable texts of an object — this is the whole-object reader. Use it to discover slots, to read values, and (by calling it per language) to compare.

| Arg | Required | Notes |
|-----|----------|-------|
| `target_type` | ✅ | |
| `object_name` | ✅ | Technical name, e.g. `ZMY_DATA_ELEMENT`. |
| `language` | ➖ | Language to read in. **Omit** to read in the object's original language; the effective language is returned in the response. |
| `field_name` | ➖ | Client-side filter — keep only slots of this CDS field (`data_definition` / `metadata_extension`). |
| `position` | ➖ | Client-side filter — keep only slots at this position. |
| `text_pool_owner_type` | ➖ | `class` (default) or `function_group` for `text_pool`. |

```json
{
  "name": "TranslateGetTexts",
  "arguments": { "target_type": "metadata_extension", "object_name": "ZC_ANOMALIESHU", "language": "FR" }
}
```

Returns `{ target_type, object_name, language, texts: [{ level, field_name, position?, attribute, value, populated, owner? }] }`, where:

- `populated` is `true` when the slot is filled in this language, `false` when it exists but is empty (**still to translate**).
- `position` is present only for repeatable annotations; the `attribute` is the **base** name (e.g. `ui_facet_label`), so `(field_name, position, attribute)` feeds `TranslateSetTexts` unchanged.
- `owner` is present on **CDS rows** (`cds_entity`, and the single `data_definition` / `metadata_extension` reads): `"data_definition"` or `"metadata_extension"`, naming the physical object the slot lives in. Pass it back **unchanged** to `TranslateSetTexts` to route the write. Non-CDS targets have no `owner`.
- For `cds_entity`, if only one of the two physical reads returns rows (e.g. the view has no DDLX) you just get those rows. If a sub-read **errors**, the successful rows are still returned and the failure is attached as `errors: [{ target_type, owner, error }]` (partial success). The two reads do not deduplicate: a `data_definition` row and a `metadata_extension` row may share `field_name`+`attribute` and are still distinct slots.

To **list only filled** texts, keep entries with `populated === true`. To **compare** two languages, call once per language and diff on `(field_name, position, attribute, populated, value)`.

---

## `TranslateSetTexts`

Write/update translations. **Requires a transport request.**

| Arg | Required | Notes |
|-----|----------|-------|
| `target_type`, `object_name`, `language` | ✅ | |
| `transport` | ✅ | e.g. `K900123`. |
| `texts` | ✅ | `[{ attribute, value, field_name?, position?, owner? }]`, at least one entry. |
| selectors | ➖ | e.g. `fixed_value` for a domain, `message_number` for a message class. |

Each `texts` entry may carry its own `field_name`/`position` (address several CDS fields in one call). For a **`cds_entity`** write, **every** entry must carry the `owner` returned by `TranslateGetTexts` — rows are **grouped by `owner`** and each group written to its physical object (`"data_definition"` → the view, `"metadata_extension"` → the DDLX) in one backend call, so each object is locked/transported once. A `cds_entity` write with **any** row missing `owner` is **rejected** (LISA never guesses the object). Entity-level texts (the view's own `endusertext_label`) must go out with an **empty `field_name`** — never inherited from another row. A positional slot keeps its 1-based index in `position` (string), bare attribute (e.g. `ui_lineitem_label`); the index is never renumbered or bracketed. The result reports, per owner, how many texts were written and the sub-call status — writes are **not atomic** across the two objects, so a partial write returns `success: false` with both outcomes:

```json
{ "success": true, "results": [
  { "target_type": "data_definition",   "owner": "data_definition",   "written": 1, "success": true },
  { "target_type": "metadata_extension","owner": "metadata_extension","written": 4, "success": true }
] }
```

For the single targets (`data_definition` / `metadata_extension` and the non-CDS types) nothing changes: one 1:1 backend write returning `{ …, transport, success }`, and an entry without its own `field_name`/`position` falls back to the top-level selectors.

```json
{
  "name": "TranslateSetTexts",
  "arguments": {
    "target_type": "data_element",
    "object_name": "ZMY_AMOUNT",
    "language": "DE",
    "transport": "K900123",
    "texts": [
      { "attribute": "short_field_label",  "value": "Betrag" },
      { "attribute": "medium_field_label", "value": "Betrag" },
      { "attribute": "long_field_label",   "value": "Betrag (Hauswährung)" }
    ]
  }
}
```

Common `attribute` values by `target_type`:

| `target_type` | attributes |
|---------------|-----------|
| `cds_entity` | any of the `data_definition` / `metadata_extension` attributes below; carry each row's `owner` so it routes to the right object. |
| `data_element` | `short_field_label`, `medium_field_label`, `long_field_label`, `heading_field_label` |
| `data_definition` / `metadata_extension` | `endusertext_label`; for positional UI labels pass the **base** attribute (e.g. `ui_facet_label`) + the per-entry `position` from `TranslateGetTexts`. |
| `message_class` | `message_short_text` (with `message_number` selector) |
| `domain` | `fixed_value_description` (with `fixed_value` selector) |

Returns `{ …, transport, success }`.

---

## A typical workflow

1. `TranslateListLanguages` — confirm the target language is installed.
2. `TranslateGetTexts` (no `language`) — read the object in its original language; every slot comes back with its full key and `populated: true`.
3. `TranslateGetTexts` (target language) — the same slots come back, with `populated: false` (and `value: ""`) for whatever is still missing.
4. `TranslateSetTexts` (target language, with a transport) — write the translations, reusing `(field_name, position, attribute, owner)` straight from step 2/3. For a `cds_entity`, the `owner` on each row routes it back to the right physical object automatically.
5. `TranslateGetTexts` (target language) again — verify nothing is left with `populated: false`.

> **Tip — CDS entities:** start from `target_type: "cds_entity"` in steps 2–4. One read returns the view *and* its DDLX together (each row carrying `owner`), and one `TranslateSetTexts` writes both back, each object locked/transported once — no need to drive `data_definition` and `metadata_extension` separately.
