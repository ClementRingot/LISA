# Releasing

LISA ships as **tagged releases**. A tag (`vX.Y.Z`) is an immutable pointer:
what you deploy from a tag today is what you'll redeploy from it in a month —
which is exactly what you want for production and rollbacks. `main` is the
integration branch and moves; **don't deploy `main` to production**, deploy a
tag.

## What "the version" means here

One **product version** is tagged (`vX.Y.Z`). Three files carry it and must
always agree:

| File | Why it carries the version |
|------|----------------------------|
| `package.json` (root) | the npm/workspace version |
| `packages/server/package.json` | the deployable server |
| `mta.yaml` | the label baked into the `.mtar` (`lisa_X.Y.Z.mtar`) |

`@lisa/core` and `lisa-arc1-extension` are **versioned independently** — they're
separate distributions, not part of the product version. The extension has its
own release line, tagged **`arc1-extension-vX.Y.Z`** (distinct from the product
`vX.Y.Z` namespace). `@lisa/core` is private and consumed only via the `"*"`
workspace range, so its `version` is inert and unchecked.

`npm run check:version` enforces two independent invariants (CI runs it on
every PR, so a mismatch can't be merged):

1. **Product version** — the three files above must agree.
2. **ARC-1 extension version** — `packages/arc1-extension/package.json` must
   match `plugin.version` in `packages/arc1-extension/src/index.ts`. ARC-1
   reads the latter at load time (it's what shows up in the host/audit), so the
   two can drift silently; this catches it. When you bump the extension, change
   both.

> **`mta.yaml` does not select what gets built.** `mbt build` builds the
> current working tree, not a git ref — it has no notion of git at all. The
> `version:` in `mta.yaml` is only a *label*. That's why it must be bumped in
> lockstep with the tag: at the tag, the label is true; on `main` past the tag,
> it would lie. To build a specific release, check the tag out first (below).

## Version bumps are driven by Changesets

Bumps are **never hand-typed**. We use [Changesets](https://github.com/changesets/changesets)
so the version number and `CHANGELOG` entry are *derived* from small intent files committed
with each PR. This closes the gap that once left the extension frozen at `0.1.0` across several
`feat`s:

> **Every PR that changes shipped package source must add a changeset.**
> CI runs `scripts/require-changeset.mjs` and fails the PR otherwise.

On each PR, declare what (if anything) should be released:

```bash
npx changeset               # pick package(s) + patch/minor/major, write a summary
```

- Bumping **`lisa-server`** drives the **product** version (`vX.Y.Z`).
- Bumping **`lisa-arc1-extension`** drives the **extension** version (`arc1-extension-vX.Y.Z`).
- **Changing `@lisa/core` requires bumping BOTH** `lisa-server` **and** `lisa-arc1-extension`.
  `@lisa/core` is bundled/inlined into both artifacts, so a core change ships inside both — the
  guard fails a core-source change that doesn't cover both dependents. You never write a changeset
  for `@lisa/core` itself (it's ignored by Changesets); you bump its two dependents.
- A genuinely release-irrelevant source change (comments, build-only tweak) is recorded with an
  **empty** changeset so the guard still passes: `npx changeset add --empty`.

Commit the generated `.changeset/*.md` with your PR. `@lisa/core` is ignored by Changesets
(`.changeset/config.json`), so never write a changeset for it.

## Cutting a release

From a clean `main` with pending changesets:

```bash
npm run changeset:version
```

This one command:

1. `changeset version` — consumes the pending changesets, bumps each affected package's
   `package.json`, and rolls each `packages/*/CHANGELOG.md`;
2. `scripts/sync-versions-after-changeset.mjs` — mirrors the bumped versions into the
   non-package files: `mta.yaml`, root `package.json`, and `plugin.version` in
   `packages/arc1-extension/src/index.ts`;
3. refreshes `package-lock.json`;
4. re-runs `check:version` — both version lines must stay internally consistent.

Review the diff, validate, and commit:

```bash
npm run lint && npm test && npm run build
git add -A && git commit -m "chore(release): version packages"
```

Then tag **only the cadences that actually moved** — never hand-type the tag or the
release title. `npm run tag` derives both from the version already committed, using the
one convention in `scripts/lib/release-naming.mjs`:

```bash
npm run tag product              # → tag v0.8.5            title "v0.8.5"
npm run tag extension            # → tag arc1-extension-v0.2.0  title "lisa-arc1-extension v0.2.0"
npm run tag product -- --headline "Batch CDS translations"   # title "v0.8.5 — Batch CDS translations"

# add --push to push the tag, and --release to also open the GitHub release with the canonical title:
npm run tag product -- --push --release
git push origin main             # push the release commit itself
```

The generator refuses a dirty tree, an existing tag, or a version-sync mismatch, so a
tag can only ever point at a committed, self-consistent version.

### Tag & release-title conventions (enforced three ways)

| Cadence | Tag | Release title |
|---------|-----|---------------|
| product | `vX.Y.Z` | `vX.Y.Z`[` — headline`] |
| extension | `arc1-extension-vX.Y.Z` | `lisa-arc1-extension vX.Y.Z`[` — headline`] |

1. **Generated, not typed** — `npm run tag <product\|extension>` builds the exact tag +
   title from `package.json`; a typo or a tag↔version drift is impossible by construction.
2. **CI backstop** — `.github/workflows/release-guard.yml` runs `scripts/check-release-naming.mjs`
   on every pushed tag (name + version match) and every release (title is canonical), catching
   anything created by hand.
3. **Server-side ruleset** — a GitHub *tag* ruleset ("Tag naming convention") restricts tag
   *creation* to the `v…` and `arc1-extension-v…` prefixes, so a malformed tag is rejected at
   push time before it enters the repo.

If you create a release by hand instead of `--release`, title it **exactly** as the table above
(the CI release-guard fails otherwise).

### Publishing the extension to npm

The extension is published publicly as **`@lisa-mcp/arc1-extension`** (the product server and
`@lisa/core` stay `private` and are never published). Publication is **fully automated**: pushing an
`arc1-extension-vX.Y.Z` tag triggers `.github/workflows/publish-extension.yml`, which validates the
tag↔version match, builds the bundle, and runs `npm publish` with the `NPM_TOKEN` repo secret. So the
normal flow is simply:

```bash
npm run tag extension -- --push        # push arc1-extension-vX.Y.Z → CI publishes to npm
```

- The published tarball is the single bundled `dist/index.js` (+ map), `README.md`, `LICENSE`,
  `package.json` — `@lisa/core` is inlined, `arc-1` and `zod` are peer deps (host-provided).
- `npm publish` fails if the version already exists on npm, so a tag is only ever published once.
- **Prerequisites (one-time):** the `@lisa` npm org must exist and be owned by the publisher, and the
  `NPM_TOKEN` repository secret must be set (a granular token scoped to `@lisa-mcp/arc1-extension`,
  *Read and write*). If the `@lisa` scope is unavailable, rename to a scope you own (e.g.
  `@clementringot/arc1-extension`) in `packages/arc1-extension/package.json` and update
  `EXTENSION` in `scripts/require-changeset.mjs` to match.

> The **npm name** (`@lisa-mcp/arc1-extension`), the **git tag** (`arc1-extension-vX.Y.Z`), and the
> **runtime plugin name** (`lisa-arc1-extension`, what ARC-1 registers) are three deliberately
> independent identities — only the npm name is the public distribution name.

> **Legacy path — `scripts/release.sh <version>`.** Predates Changesets: it hand-bumps the three
> product-version files and rolls the root `CHANGELOG.md`. Still usable for a **manual product-only**
> release, but it **bypasses** the changeset flow and ignores the extension. Prefer
> `npm run changeset:version`; never run both for the same release (they double-bump).

## Building a released artifact

Build from the **tag**, so the `.mtar`'s `0.7.0` label is truthful:

```bash
git checkout v0.7.0
mbt build                 # → mta_archives/lisa_0.7.0.mtar
```

See [BTP deployment](./btp-deployment.md) for the deploy itself.

## Which ref to deploy

Deployment has **two independent axes**:

- **Which code** — chosen by the git ref you check out: `main` vs a tag `vX.Y.Z`.
- **Which landscape** — chosen by your `cf target` (org/space) **and** the
  matching `.mtaext` (host + destinations). The `.mtaext` alone is not enough:
  if you're targeted at the prod space but pass the sbx extension, you deploy
  the sandbox config into prod. Always confirm `cf target` first.

| Context | Code | Landscape |
|---------|------|-----------|
| **Sandbox** | `main` — that's where you validate before tagging | sandbox space + `mta-overrides-sbx.mtaext` |
| **Production** | the latest **tag** (`git checkout vX.Y.Z`) — never a moving branch | prod space + `mta-overrides-prod.mtaext` |

Each landscape needs its own `.mtaext` (copied from
`mta-overrides.mtaext.example`, gitignored) with its own host, destinations,
and — if it shares a subaccount with another instance — its own XSUAA
`xsappname`. Each also needs its own `LISA_DCR_SIGNING_SECRET`
(see [BTP deployment §5](./btp-deployment.md)).

### Sandbox, from `main`

```bash
git checkout main && git pull
cf target -o <org> -s <sandbox-space>     # confirm you're on sandbox
npm run btp:build-deploy-sbx              # mbt build + cf deploy -e …-sbx.mtaext
```

### Production, from a release tag

```bash
git checkout v0.7.0                       # the immutable release, not main
cf target -o <org> -s <prod-space>        # confirm you're on prod
npm run btp:build-deploy-prod             # mbt build + cf deploy -e …-prod.mtaext
```

Building from the tag is what makes the `.mtar` name (`lisa_0.7.0.mtar`) and the
deploy command's `$npm_package_version` agree — on `main` past the tag they'd
still say the old version (the label would lie). `check:version` guarantees the
`.mtar` label and `package.json` always match at a given ref.

> First prod deploy: `cp mta-overrides.mtaext.example mta-overrides-prod.mtaext`,
> fill in the prod host/destinations, then set `LISA_DCR_SIGNING_SECRET` on the
> app once (see [BTP deployment §5](./btp-deployment.md)) — it survives
> redeploys, so you only do it once per landscape.

## Keeping the CHANGELOG honest

Changelogs are generated from changesets, per package
(`packages/server/CHANGELOG.md`, `packages/arc1-extension/CHANGELOG.md`) — you don't hand-edit
them. Just make sure the **changeset summary** you write on each PR reads as a real changelog
line, because that text is what lands verbatim. The root `CHANGELOG.md` holds the pre-Changesets
history; new entries flow through the per-package files.
