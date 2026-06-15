# MCP tools usage

`LISA` exposes **3 tools**. Every authenticated caller sees all three. This page documents each tool's inputs and gives example calls.

> Earlier builds shipped `TranslateListTexts` and `TranslateCompare`. Both are gone — `TranslateGetTexts` is now the whole-object reader, so "list" and "compare" are done by reading (and diffing) its output. See [A typical workflow](#a-typical-workflow).

## Common concepts

### `target_type`

The kind of object to translate — an XCO **semantic literal**, not a DDIC short code:

| `target_type` | SAP object |
|---------------|-----------|
| `data_element` | Data element (DTEL) |
| `domain` | Domain fixed-value texts (DOMA) |
| `data_definition` | CDS view (DDLS) entity/field labels |
| `message_class` | Message class (MSAG) |
| `text_pool` | Class / function-group text symbols |
| `metadata_extension` | CDS metadata extension (DDLX) UI labels |
| `application_log_object` | Application log object (APLO) |
| `business_configuration_object` | Business configuration object (SMBC) |

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

Returns `{ target_type, object_name, language, texts: [{ level, field_name, position?, attribute, value, populated }] }`, where:

- `populated` is `true` when the slot is filled in this language, `false` when it exists but is empty (**still to translate**).
- `position` is present only for repeatable annotations; the `attribute` is the **base** name (e.g. `ui_facet_label`), so `(field_name, position, attribute)` feeds `TranslateSetTexts` unchanged.

To **list only filled** texts, keep entries with `populated === true`. To **compare** two languages, call once per language and diff on `(field_name, position, attribute, populated, value)`.

---

## `TranslateSetTexts`

Write/update translations. **Requires a transport request.**

| Arg | Required | Notes |
|-----|----------|-------|
| `target_type`, `object_name`, `language` | ✅ | |
| `transport` | ✅ | e.g. `K900123`. |
| `texts` | ✅ | `[{ attribute, value }]`, at least one entry. |
| selectors | ➖ | e.g. `fixed_value` for a domain, `message_number` for a message class. |

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
| `data_element` | `short_field_label`, `medium_field_label`, `long_field_label`, `heading_field_label` |
| `data_definition` / `metadata_extension` | `endusertext_label`; for positional UI labels pass the **base** attribute (e.g. `ui_facet_label`) + the top-level `position` from `TranslateGetTexts`. |
| `message_class` | `message_short_text` (with `message_number` selector) |
| `domain` | `fixed_value_description` (with `fixed_value` selector) |

Returns `{ …, transport, success }`.

---

## A typical workflow

1. `TranslateListLanguages` — confirm the target language is installed.
2. `TranslateGetTexts` (no `language`) — read the object in its original language; every slot comes back with its full key and `populated: true`.
3. `TranslateGetTexts` (target language) — the same slots come back, with `populated: false` (and `value: ""`) for whatever is still missing.
4. `TranslateSetTexts` (target language, with a transport) — write the translations, reusing `(field_name, position, attribute)` straight from step 2/3.
5. `TranslateGetTexts` (target language) again — verify nothing is left with `populated: false`.
