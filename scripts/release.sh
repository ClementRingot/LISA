#!/usr/bin/env bash
# Cut a LISA release: bump the synced version across the files that carry it,
# roll the CHANGELOG, build/lint/test, and stage a release commit + tag.
#
# It does NOT push. The last thing it prints is the exact `git push` command,
# so you review the diff and tag first.
#
#   ./scripts/release.sh 0.7.0
#
# What it bumps (the product version — see scripts/check-version-sync.mjs):
#   - package.json (root)
#   - packages/server/package.json
#   - mta.yaml
# @lisa/core and lisa-arc1-extension are versioned independently and untouched.

set -euo pipefail

cd "$(dirname "$0")/.."

err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

# ── 1. Validate input + repo state ──────────────────────────────────────────
NEW="${1:-}"
[ -n "$NEW" ] || err "usage: ./scripts/release.sh <version>   e.g. 0.7.0"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || err "version must be semver X.Y.Z (got: $NEW)"

[ -z "$(git status --porcelain)" ] || err "working tree not clean — commit or stash first"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || info "warning: releasing from '$BRANCH', not 'main'"

git rev-parse "v$NEW" >/dev/null 2>&1 && err "tag v$NEW already exists"

CUR="$(node -p "require('./package.json').version")"
info "releasing $CUR → $NEW"

# ── 2. Bump the three synced version fields ─────────────────────────────────
node -e '
  const fs = require("fs");
  const v = process.argv[1];
  for (const f of ["package.json", "packages/server/package.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  }
' "$NEW"
# mta.yaml: replace only the top-level `version:` scalar.
perl -i -pe 's/^version:\s*.+$/version: '"$NEW"'/ if $. < 10 && /^version:/' mta.yaml

node scripts/check-version-sync.mjs || err "version-sync check failed after bump"

# ── 3. Roll the CHANGELOG: [Unreleased] → [X.Y.Z] — DATE, add fresh Unreleased
DATE="$(date +%Y-%m-%d)"
if grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  perl -i -pe 's/^## \[Unreleased\].*$/## [Unreleased]\n\n## ['"$NEW"'] — '"$DATE"'/ if !$done && /^## \[Unreleased\]/ and ($done=1)' CHANGELOG.md
  ok "CHANGELOG: rolled [Unreleased] → [$NEW] — $DATE"
else
  info "no [Unreleased] section in CHANGELOG.md — add the [$NEW] section by hand"
fi

# ── 4. Verify the build is releasable (server + core only) ──────────────────
info "lint / test / build (core + server)…"
npm run lint  --workspace packages/core --workspace packages/server
npm test      --workspace packages/core --workspace packages/server
npm run build --workspace packages/core --workspace packages/server
ok "build green"

# ── 5. Stage commit + annotated tag (local only — no push) ──────────────────
git add package.json packages/server/package.json mta.yaml CHANGELOG.md
git commit -m "chore(release): v$NEW"
git tag -a "v$NEW" -m "v$NEW"
ok "committed + tagged v$NEW (local)"

cat <<EOF

Next:
  git show v$NEW            # review the release commit
  git push origin $BRANCH --follow-tags

To build the released artifact from a clean checkout:
  git checkout v$NEW
  mbt build                # → mta_archives/lisa_$NEW.mtar
EOF
