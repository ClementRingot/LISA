# MCP tools usage

`sap-translator` exposes **5 tools**. Every authenticated caller sees all five. This page documents each tool's inputs and gives example calls.

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

## `TranslateListTexts`

List the translatable text attributes of an object. **Run this first** to discover what `attribute`s exist before reading/writing.

| Arg | Required | Notes |
|-----|----------|-------|
| `target_type` | ✅ | |
| `object_name` | ✅ | Technical name, e.g. `ZMY_DATA_ELEMENT`. |
| `language` | ➖ | Source language to read values in (defaults to system language). |
| `text_pool_owner_type` | ➖ | `class` (default) or `function_group` for `text_pool`. |

```json
{
  "name": "TranslateListTexts",
  "arguments": { "target_type": "data_element", "object_name": "ZMY_AMOUNT" }
}
```

Returns `texts: [{ level, field_name, attribute, value }]`.

---

## `TranslateGetTexts`

Read the translations of an object in one language.

| Arg | Required |
|-----|----------|
| `target_type`, `object_name`, `language` | ✅ |
| selectors | ➖ |

```json
{
  "name": "TranslateGetTexts",
  "arguments": { "target_type": "data_element", "object_name": "ZMY_AMOUNT", "language": "DE" }
}
```

Returns `texts: [{ attribute, value }]`.

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
| `data_definition` / `metadata_extension` | `endusertext_label` |
| `message_class` | `message_short_text` (with `message_number` selector) |
| `domain` | `fixed_value_description` (with `fixed_value` selector) |

Returns `{ …, transport, success }`.

---

## `TranslateCompare`

Compare a source vs. target language for an object and flag differences.

| Arg | Required | Notes |
|-----|----------|-------|
| `target_type` | ✅ | Supported: `data_element`, `data_definition`, `metadata_extension`, `domain`, `message_class`. |
| `object_name` | ✅ | |
| `source_language` | ✅ | Reference language (already translated), typically `EN`. |
| `target_language` | ✅ | Language to check (may be incomplete). |
| `position` | ➖ | For repeatable `metadata_extension` annotations. |

```json
{
  "name": "TranslateCompare",
  "arguments": {
    "target_type": "data_element",
    "object_name": "ZMY_AMOUNT",
    "source_language": "EN",
    "target_language": "DE"
  }
}
```

Returns `items: [{ field_or_key, source_texts, target_texts, has_difference }]`. There are no aggregate total/translated/missing counts — iterate `has_difference` to find gaps.

---

## A typical workflow

1. `TranslateListLanguages` — confirm the target language is installed.
2. `TranslateListTexts` — discover the attributes of the object.
3. `TranslateGetTexts` (source language) — read the source values to translate from.
4. `TranslateSetTexts` (target language, with a transport) — write the translations.
5. `TranslateCompare` — verify nothing is left untranslated.
