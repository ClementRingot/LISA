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
separate distributions, not part of the product version — so they're left
alone by the release flow.

`npm run check:version` fails if those three drift apart, and CI runs it on
every PR, so a mismatch can't be merged.

> **`mta.yaml` does not select what gets built.** `mbt build` builds the
> current working tree, not a git ref — it has no notion of git at all. The
> `version:` in `mta.yaml` is only a *label*. That's why it must be bumped in
> lockstep with the tag: at the tag, the label is true; on `main` past the tag,
> it would lie. To build a specific release, check the tag out first (below).

## Cutting a release

From a clean `main` (or a release branch), with the `CHANGELOG.md`
`[Unreleased]` section reflecting what's shipping:

```bash
npm run release 0.7.0
```

The script (`scripts/release.sh`) does, in order:

1. Validates the version is semver and the tag doesn't already exist.
2. Bumps the three synced version fields.
3. Runs `check:version` to confirm they agree.
4. Rolls the `CHANGELOG`: `[Unreleased]` → `[0.7.0] — <today>`, and opens a
   fresh `[Unreleased]`.
5. Runs `lint` / `test` / `build` for **core + server** (the releasable
   artifact — not `arc1-extension`).
6. Creates the release commit `chore(release): v0.7.0` and an annotated tag
   `v0.7.0` — **locally**. It does not push.

Then review and push:

```bash
git show v0.7.0
git push origin main --follow-tags
```

`--follow-tags` pushes the commit and the annotated tag together. (The script
prints these commands at the end, so you don't have to remember them.)

## Building a released artifact

Build from the **tag**, so the `.mtar`'s `0.7.0` label is truthful:

```bash
git checkout v0.7.0
mbt build                 # → mta_archives/lisa_0.7.0.mtar
```

See [BTP deployment](./btp-deployment.md) for the deploy itself.

## Which ref to deploy

| Context | Deploy |
|---------|--------|
| **Production / standalone CF** | the latest tag (`git checkout vX.Y.Z`). Need a fix that's only on `main`? Cut a new release and deploy *that* tag. |
| **Sandbox / dev** | `main` is fine — that's where you validate before tagging. |

## Keeping the CHANGELOG honest

The release flow only works if `[Unreleased]` actually describes what's
shipping. Add a line to `[Unreleased]` as part of any user-facing change —
then cutting the release is just `npm run release <version>`.
