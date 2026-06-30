# Wire-contract evolution & ABAP platform divergence

How LISA copes with XCO i18n APIs that differ between ABAP releases, and how to grow the
contract over time **without** forking the MCP. Read this before adding a `target_type`, a
parameter, or a new platform variant.

## The one invariant — protect it

Whatever XCO does across releases, **the JSON wire contract stays identical on every platform**:
the request parameters, the response shape, and the `capabilities` allow-list. That contract is
LISA's abstraction boundary. As long as it holds:

- the MCP / TypeScript side stays **a single, platform-agnostic build** — never one MCP per
  platform;
- all platform divergence lives **below** that boundary (in the ABAP class), or is exposed
  **additively** through `capabilities`.

So the real question is never "should we fork the MCP" — it is "how do we organise the **ABAP**
code so the divergence does not rot." The answer depends on the *kind* of divergence.

## Why one MCP, not one per platform

The divergence is fully absorbed in the ABAP layer. Example already in the codebase: the XCO
parameter for a text-table language field is `iv_language_field_name` on ABAP Platform 2022
(7.57) but `iv_language_key_field_name` on newer releases. Yet LISA **always** sends the same
JSON key `language_key_field_name`; each per-platform ABAP class maps it to the right XCO
parameter internally. From the MCP's point of view there is **no** behavioural difference.

A per-platform MCP would be wrong because:

1. **The TypeScript would be byte-for-byte identical.** You would ship N copies of one server.
   The platform is decided by *deployment* (which ABAP class is installed on which SAP system),
   not by the MCP build.
2. **One MCP instance talks to one SAP system** (its configured `SAP_I18N_SERVICE_PATH` /
   destination), and that system already has exactly one handler class deployed — the one for its
   platform. The resolution happens there.
3. **`capabilities` is the designed seam.** It already advertises, per action, the object types
   the *connected* backend supports; LISA follows whatever the bound handler reports, with no TS
   change.

The only thing that would *force* a change is the **JSON contract itself** diverging per platform
(different param name, different response shape). Keep that from happening and the MCP stays
single-build forever.

## Where divergence lives today

- **`abap/` is split per platform**, one self-contained class per folder, all named
  **`ZCL_I18N_SERVICE`** (separated by folder, not class name): `ABAP_PLATFORM_2022/` and
  `ABAP_PLATFORM_2025/` (on-premise / private cloud) and `CLOUD/` (BTP ABAP Environment). See
  [`abap/README.md`](../abap/README.md).
- **`capabilities`** absorbs per-stack and per-version differences in *which object types* are
  available, dynamically. `supportedTargetTypesNote()` injects the connected system's concrete
  allow-list into each tool description, and `assertActionSupported()` rejects an unsupported
  `target_type` up-front.

## The compilation wall

ABAP compiles per system. A XCO symbol that is **absent** on a stack (a type, class, or method
not delivered there) makes activation fail. So the *kind* of divergence dictates what is possible:

| Divergence | Consequence |
|---|---|
| **Signature / parameter rename** (e.g. `iv_language_field_name` → `iv_language_key_field_name`) | Light. Absorbable behind one mapping/adapter or a runtime guard. |
| **New / removed symbols** (an API that does not exist on the other stack) | **Must** live in separate compilation units. No workaround. |

This wall is why the **Cloud vs on-premise** split is permanent — Cloud-released APIs and
unreleased on-prem DDIC reads simply do not exist on the other side. The `2022` vs `2025`
on-premise variants can only ever be merged if the newer code references *no* symbol that is
absent on the older release.

## Escalation tiers for growing divergence

Do not refactor pre-emptively. Move up a tier only when the pain justifies it.

### Tier 0 — today (low divergence): self-contained copies + discipline

Works while differences are small. Mitigate the sync risk with:

- a **parity guard**: a script or CI test that diffs the *shared regions* of the per-platform
  files and flags drift (the classic failure is a fix applied to 2 of 3 files);
- clear comment markers in each class, e.g. `" --- SHARED ---` / `" --- PLATFORM-SPECIFIC ---`.

### Tier 1 — when sync pain exceeds the value of self-containment: a shared base class

Introduce `ZCL_I18N_SERVICE_BASE` (abstract) holding all **non-XCO** logic — action dispatch,
JSON helpers, parameter parsing, the `capabilities` allow-list. The platform-specific XCO calls
become **abstract methods** each subclass implements. The per-platform handler classes become
thin (just the XCO bindings).

- Kills the duplication of ~1000 shared lines.
- Loses the "one object to import" property (you now import the base **plus** your subclass).
- Right trade once `duplication cost > self-containment value`. Cloud stays separate by necessity;
  `2022` / `2025` become subclasses too.

### Tier 1bis — many small mechanical differences: generate the variants

If the divergence is "N small mechanical diffs", keep one annotated source and add a codegen step
that emits `2022` / `2025` / `CLOUD` (conditional blocks). One file to maintain, the build emits
three. Cost: it adds a build step to an otherwise build-free ABAP tree — only worth it if the
pattern is genuinely "many small differences × many platforms".

### Tier 2 — the contract itself needs to grow

A newer stack needs a new `target_type`, parameter, or response field. **Extend the contract
additively and optionally**, and let `capabilities` advertise who supports it. Old backends do not
list the new capability; the TS stays one build and degrades cleanly. Worked examples below.

### Decision signals

- **How many times a single fix must be applied** — two variants + occasional fix → stay copy
  + parity guard; frequent shared-logic churn → Tier 1.
- **How many variants exist** — at 4+ folders the base class becomes mechanically worth it.

## Tier 2, worked example A — a new `target_type`, gated by `capabilities`

Scenario: a future ABAP Platform 2027 adds a XCO target `structure` (DDIC structure field
labels) that older stacks do not have.

**ABAP — only the 2027 class implements it.**

```abap
" dispatch in set_translation / list_texts
WHEN 'structure'.
  DATA(lo_struct_set) = xco_i18n=>target->structure( ... ).  " symbol absent on older stacks
  ...

" handle_capabilities — declare the new possibility
"   set_translation : [ ..., "text_table", "structure" ]
"   list_texts      : [ ..., "text_table", "structure" ]
```

The `2022` / `2025` / `CLOUD` classes are untouched: they do not reference the `structure` XCO
symbol (so they still activate on their stack) and do not list it in their allow-list.

**TypeScript — one additive line** in `packages/core/src/schemas.ts`:

```ts
export const TargetTypeSchema = z.enum([
  'cds_entity', 'data_element', /* … */ 'text_table',
  'structure',                 // ⬅ new, additive
]);
```

**The gating is automatic.** `assertActionSupported()` (in `packages/core/src/wire.ts`) already
consults the *connected* backend's allow-list, so with no extra code:

| Connected system | `set_translation` with `target_type: "structure"` |
|---|---|
| ABAP Platform 2027 | listed in `capabilities` → runs ✅ |
| 2022 / 2025 / CLOUD | not in the allow-list → **rejected up-front** with a clear message, without even calling SAP |

And `supportedTargetTypesNote('set_translation', caps)` already injects the connected system's
concrete list into the tool description, so the agent is only offered `structure` when bound to a
2027 box. One TS build, two correct behaviours.

## Tier 2, worked example B — the lighter variant: a single optional parameter

Scenario: a newer backend adds an optional `fallback_language` to `TranslateGetTexts` — when a
slot is empty in the requested language, return that fallback language's text as a reference. It
is **read-only, optional**, and an old backend that ignores it degrades to today's behaviour
(empty slot). No `capabilities` gating needed (see the criterion below). This is the same
threading as `text_table`, but smaller (one scalar, read side only).

**1. `packages/core/src/schemas.ts`** — read-only, so add it to `GetTextsSchema` directly (not to
`SelectorShape`, which the write tool shares):

```ts
export const GetTextsSchema = z.object({
  target_type: TargetTypeSchema,
  object_name: z.string().min(1).describe(/* … */),
  language: LanguageSchema.optional().describe(/* … */),
  fallback_language: LanguageSchema.optional().describe(
    'Optional, newer backends only: when a slot is empty in `language`, return the text from this ' +
      'language as a reference instead of an empty value. Ignored by backends that do not support it.',
  ),
  ...SelectorShape,
});
```

`.optional()` → existing payloads stay valid (existing tests stay green).

**2. `packages/core/src/wire.ts`** — add to the `getTexts` param type; the spread carries it into
the body, and `compact()` drops it when empty so an old backend never sees it:

```ts
async getTexts(params: {
  target_type: string;
  object_name: string;
  language?: string;
  text_pool_owner_type?: string;
  language_key_field_name?: string;
  master_key_fields?: Array<{ name: string; value: string }>;
  fallback_language?: string;            // ⬅ add
}): Promise<ListTextsResult> {
  await this.assertActionSupported('list_texts', params.target_type);
  const data = await callAction<ListTextsResult>(this.transport, 'list_texts', { ...params });
  // …
}
```

**3. `packages/server/src/handlers/intent.ts`** — pass it through the non-cds `getTexts` call:

```ts
: await client.getTexts({
    target_type: args.target_type,
    object_name: args.object_name,
    language: args.language,
    text_pool_owner_type: args.text_pool_owner_type,
    language_key_field_name: args.language_key_field_name,
    master_key_fields: args.master_key_fields,
    fallback_language: args.fallback_language,   // ⬅ add
  });
```

**4. `packages/arc1-extension/src/tools/Custom_TranslateGetTexts.ts`** — the `a` cast and the
`getTexts` call, same as above. (The write tool and `setTranslation` are untouched — that is what
makes this variant "light".)

**5. Test (optional but clean)** in `packages/core/src/schemas.test.ts`:

```ts
it('accepts an optional fallback_language on read', () => {
  const r = GetTextsSchema.safeParse({
    target_type: 'data_element', object_name: 'ZMY', language: 'DE', fallback_language: 'EN',
  });
  expect(r.success).toBe(true);
});
```

**6. ABAP — only the newer class reads it** in `handle_list_texts`:

```abap
DATA(lv_fallback) = extract_param( iv_params = iv_params iv_name = 'fallback_language' ).
" … if set and the slot is empty, read the value in lv_fallback as a reference.
```

Older classes do not read it. The handler string-matches **only the params it knows**, so an
unknown param is **ignored without error**. On an old stack: empty slot, exactly as today.

## The decision criterion — light vs heavy

Before skipping the `capabilities` gate, ask:

> **If an old backend silently ignores this parameter, can the caller make a dangerous wrong
> assumption?**

- **Safe to ignore (light, optional is enough).** Example: `fallback_language`. Ignoring it = no
  reference shown, normal empty slot. No effect on the data.
- **Unsafe to ignore (must gate via `capabilities`).** Example: a `skip_if_translated` flag ("do
  not overwrite an already-translated slot"). If the old backend ignores it, it **overwrites
  anyway** while the caller believed the slot was protected — a bad surprise. The agent must know
  whether the backend honours it, so add a `capabilities` entry (the full Tier 2).

That single test — *is silent-ignore safe?* — decides between the two.

## Quick checklist for any contract change

- [ ] Is the change **additive** (new optional param / new enum value), never a breaking edit to
      an existing field? If not, stop — that breaks the invariant.
- [ ] Threaded through every distribution: `schemas.ts` → `wire.ts` → `intent.ts` →
      `arc1-extension` tools.
- [ ] Optional params are `.optional()` and dropped by `compact()` when empty.
- [ ] If silent-ignore by an old backend is **unsafe**, add a `capabilities` entry and let
      `assertActionSupported()` / `supportedTargetTypesNote()` gate and advertise it.
- [ ] New `target_type` listed in `handle_capabilities` **only** on the stacks that implement it.
- [ ] Build green (`npm run build`), tests green (`npm test`), lint green (`npm run lint`).
- [ ] One MCP build still serves all platforms — no per-platform fork.

## See also

- [`architecture.md`](./architecture.md) — component map and where each handler class lives.
- [`abap/README.md`](../abap/README.md) — the per-platform folders, the wire contract, and the
  "keep the three variants in sync" note.
- [`mcp-usage.md`](./mcp-usage.md) — the `target_type` catalog and tool semantics.
