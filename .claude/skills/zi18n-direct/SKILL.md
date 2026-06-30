---
name: zi18n-direct
description: Make SAP object-translation calls (list languages, read texts, write translations) by calling the ABAP zi18n_service HTTP API DIRECTLY — no MCP server. Use when an AI agent must translate SAP objects but cannot or should not use LISA's MCP server (no MCP client, scripting/CI, a custom agent). Runs a bundled zero-dependency Node client that handles auth (incl. minting the per-user SAML2 assertion / Bearer token from the BTP Destination Service), the response envelope, virtual cds_entity fan-out, and positional-label normalization. For the full request/response contract see the zi18n-service-api skill.
---

# Translate SAP objects directly (no MCP)

This skill lets an agent drive SAP translations **without** LISA's MCP server, by running a bundled
client that POSTs to the ABAP `zi18n_service` HTTP API. The client
([`zi18n_client.mjs`](./zi18n_client.mjs), Node 18+, zero deps) mirrors `@lisa/core` so you get the
**same conveniences the MCP gives**: auth (including the per-user SAML/Bearer token mint), envelope
unwrap + error mapping, virtual `cds_entity` fan-out, and positional `name[n]` normalization.

> **Prefer the MCP server when it's available.** If the agent *can* speak MCP, point it at the deployed
> `…/mcp` instead — LISA then handles auth, schema validation, and the capabilities allow-list for you,
> and writes are constrained by typed tools. Use this skill for non-MCP contexts (CI/scripts, a custom
> agent, debugging what the MCP forwards).

## 1. Configure the connection (env vars)

Pick **one** mode by setting its env vars:

| Mode | When | Env vars |
|------|------|----------|
| **Direct** | on-premise / private cloud, local, or any reachable host with a token/creds | `ZI18N_BASE_URL` (e.g. `https://host:443`) + **either** `ZI18N_USER`+`ZI18N_PASS` (Basic) **or** `ZI18N_BEARER` (a token). Optional `ZI18N_SAP_CLIENT`. |
| **BTP per-user** | S/4HANA Cloud / BTP ABAP, acting **as the end user** | run inside CF (so `VCAP_SERVICES` is present) + `ZI18N_DESTINATION` (the destination name) + `ZI18N_USER_JWT` (a user XSUAA access token). The client fetches the per-user **SAML2 assertion / Bearer** from the Destination Service automatically. |
| **BTP technical** | S/4HANA Cloud / BTP ABAP, single technical identity | same as above **without** `ZI18N_USER_JWT` — resolves the destination's own credentials (e.g. an `OAuth2ClientCredentials` Bearer, or Basic for a communication user). |

Common: `ZI18N_SERVICE_PATH` (defaults to `/sap/bc/http/sap/zi18n_service` — match the service URL in ADT).

> The BTP modes need a `destination` service binding and reach the host over the **Internet**
> (`ProxyType=Internet`). On-premise Cloud-Connector principal propagation is **not** supported by this
> client (it needs the connectivity proxy) — use the MCP server for that.

Verify the resolved connection without making a translation call:

```bash
node .claude/skills/zi18n-direct/zi18n_client.mjs auth-debug
# → { "baseUrl": "...", "sapClient": "080", "authScheme": "SAML2.0", "samlSession": "create" }
```

## 2. Run the actions

```
node .claude/skills/zi18n-direct/zi18n_client.mjs <action> [bodyJSON]
```

`action` = `list_languages` | `capabilities` | `list_texts` | `set_translation`. `bodyJSON` is the
request body (omit for empty; pass `-` to read it from stdin). Success prints the action's `data` as
JSON and exits 0; any failure prints `ERROR: …` and exits 1. Build the body per the
[zi18n-service-api](../zi18n-service-api/SKILL.md) contract (target_type, selectors, attributes).

```bash
# installed languages
node .claude/skills/zi18n-direct/zi18n_client.mjs list_languages

# which target_types this stack supports
node .claude/skills/zi18n-direct/zi18n_client.mjs capabilities

# read a data element's labels in German
node .claude/skills/zi18n-direct/zi18n_client.mjs list_texts \
  '{"target_type":"data_element","object_name":"ZE_CUSTOMER_NAME","language":"DE"}'

# read a whole CDS entity (view + its DDLX) in one shot — the client fans out and merges
node .claude/skills/zi18n-direct/zi18n_client.mjs list_texts \
  '{"target_type":"cds_entity","object_name":"ZC_SALESORDER","language":"DE"}'

# write two labels in one call (object locked once)
node .claude/skills/zi18n-direct/zi18n_client.mjs set_translation \
  '{"target_type":"data_element","object_name":"ZE_CUSTOMER_NAME","language":"DE","transport":"K900001",
    "texts":[{"attribute":"short_field_label","value":"Kundenname"},
             {"attribute":"medium_field_label","value":"Name des Kunden"}]}'
```

## 3. Writing safely

`set_translation` **mutates SAP** and records the change on the `transport` you pass. For an agent:

- **Read before you write.** Run `list_texts` first to confirm the object, fields, and exact
  `attribute`s; write back the values you intend.
- **Always supply a real `transport`** (e.g. `K900001`) the user owns; never invent one.
- **Confirm writes with the human** (or run behind an approval gate) — this client does not.
- For `cds_entity` writes, pass each row's **`owner`** (`data_definition` | `metadata_extension`) back
  **verbatim** from the read; a row missing `owner` is rejected (the client never guesses).

## What the client handles for you

- **Auth**, including minting the **per-user SAML2 assertion / Bearer** from the BTP Destination Service
  (the user JWT goes out in the `X-User-Token` header; the returned `Authorization` value is sent
  verbatim, plus `x-sap-security-session: create` for SAMLAssertion). Mirrors
  `@arc-mcp/xsuaa-auth` `destination.js`.
- **Response envelope** unwrap and error mapping (`CLOUD_UNSUPPORTED` → a clear stack-limitation
  message, otherwise `SAP i18n error [CODE]: …`).
- **Virtual `cds_entity`** — fans out to `data_definition` + `metadata_extension` on read (merged, each
  row stamped with `owner`) and routes writes back by `owner`.
- **Positional labels** — splits `name[n]` (e.g. `ui_lineitem_label[1]`) into bare attribute +
  `position` on read, and recombines on write.

## What it does NOT do (vs the MCP)

- **No capabilities pre-check.** It does not gate calls on `capabilities` first; an unsupported
  `(action, target_type)` is rejected by SAP with `CLOUD_UNSUPPORTED`. Call `capabilities` yourself if
  you want to validate up-front.
- **No on-premise Cloud Connector.** Internet/direct only — use the MCP server for on-prem PP.
- **No schema validation / no human gate** on writes (see §3).
- **No OAuth login flow** — you supply `ZI18N_USER_JWT` (or Basic/Bearer); obtaining the user token is
  out of scope (run your XSUAA OAuth flow against `VCAP_SERVICES.xsuaa[0].credentials.url`).

## Source of truth

The wire contract (actions, `target_type`s, selectors, attributes, response shapes) is documented in the
[zi18n-service-api](../zi18n-service-api/SKILL.md) skill and defined in
[`packages/core/src/wire.ts`](../../../packages/core/src/wire.ts) +
[`schemas.ts`](../../../packages/core/src/schemas.ts). The client mirrors that core plus the Destination
Service flow in `@arc-mcp/xsuaa-auth`; **keep it in sync if the wire contract evolves**
([`docs_page/wire-contract-evolution.md`](../../../docs_page/wire-contract-evolution.md)).
