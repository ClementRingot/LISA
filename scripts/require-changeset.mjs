#!/usr/bin/env node
// CI guard: a PR that changes shipped package source MUST carry a changeset that
// bumps the RIGHT package(s), so a version bump can never be silently forgotten
// (the failure that let the ARC-1 extension sit at 0.1.0 across several `feat`s).
//
// Two rules, checked against the base ref:
//
//   1. Base — if any non-test file under `packages/*/src/**` changed, the PR must
//      add at least one changeset (`.changeset/*.md`, excluding README.md).
//
//   2. Coverage — the changesets must bump every package whose shipped behaviour
//      changed:
//        - packages/server/src         → `lisa-server`
//        - packages/arc1-extension/src → `@lisa-mcp/arc1-extension`
//        - packages/core/src           → BOTH `lisa-server` AND `@lisa-mcp/arc1-extension`,
//          because `@lisa/core` is bundled/inlined into BOTH artifacts, so a core
//          change ships inside both. (`@lisa/core` is ignored by Changesets, so you
//          never write a changeset for it — you bump its two dependents.)
//
// Escape hatch: a genuinely release-irrelevant source change (pure comments, a
// build-only tweak) is declared with an EMPTY changeset — `npx changeset add --empty`
// — which satisfies both rules with a loud note.
//
// Base ref: arg 1, or $CHANGESET_BASE_REF, or origin/main.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseRef = process.argv[2] || process.env.CHANGESET_BASE_REF || 'origin/main';

const SERVER = 'lisa-server';
const EXTENSION = '@lisa-mcp/arc1-extension';

// Map a changed package directory (basename under packages/) to the released
// package name(s) that must be bumped for it. `core` fans out to both dependents.
const DIR_TO_REQUIRED = {
  server: [SERVER],
  'arc1-extension': [EXTENSION],
  core: [SERVER, EXTENSION],
};

function diffNames(base) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    // Fallback for shallow checkouts where the three-dot merge-base is unavailable.
    return execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }).split('\n').filter(Boolean);
  }
}

const isPackageSource = (f) => /^packages\/[^/]+\/src\/.+/.test(f) && !/\.test\.tsx?$/.test(f);
const isChangeset = (f) => f.startsWith('.changeset/') && f.endsWith('.md') && !f.endsWith('/README.md');
const pkgDirOf = (f) => f.match(/^packages\/([^/]+)\/src\//)?.[1];

// Parse a changeset's front-matter into the set of package names it bumps.
// An empty changeset (`---\n---`) yields an empty set and flags `empty: true`.
function parseChangeset(path) {
  const src = readFileSync(path, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = m ? m[1].trim() : '';
  if (body === '') return { packages: [], empty: true };
  const packages = [];
  for (const line of body.split('\n')) {
    const km = line.match(/^\s*['"]?([^'":]+)['"]?\s*:/);
    if (km) packages.push(km[1].trim());
  }
  return { packages, empty: false };
}

const files = diffNames(baseRef);
const sourceChanges = files.filter(isPackageSource);
const changesetPaths = files.filter(isChangeset);

if (sourceChanges.length === 0) {
  console.log(`✓ no shipped package source changed vs ${baseRef} — changeset not required`);
  process.exit(0);
}

// Rule 1 — a changeset must exist.
if (changesetPaths.length === 0) {
  console.error(`✗ package source changed vs ${baseRef} but NO changeset was added.\n`);
  console.error('  Changed source files:');
  for (const f of sourceChanges) console.error(`    ${f}`);
  console.error('\n  Add one with:  npx changeset');
  console.error('  (choose the affected package + bump level; it writes the CHANGELOG at release time)');
  console.error('  Release-irrelevant change? Record it explicitly:  npx changeset add --empty\n');
  process.exit(1);
}

// Rule 2 — which released packages must the changesets bump, given what changed?
const required = new Set();
const changedDirs = new Set(sourceChanges.map(pkgDirOf).filter(Boolean));
for (const dir of changedDirs) for (const pkg of DIR_TO_REQUIRED[dir] ?? []) required.add(pkg);

// What do the PR's changesets actually bump?
const parsed = changesetPaths.map(parseChangeset);
const bumped = new Set(parsed.flatMap((c) => c.packages));
const hasEmpty = parsed.some((c) => c.empty);

const missing = [...required].filter((pkg) => !bumped.has(pkg));

if (missing.length === 0) {
  console.log(`✓ package source changed and changesets bump all required packages: ${[...required].join(', ')}`);
  process.exit(0);
}

// Missing coverage. An explicit empty changeset is the sanctioned opt-out.
if (hasEmpty) {
  console.log(
    `⚠ package source changed without bumping ${missing.join(', ')}, but an EMPTY changeset is present — treating as a deliberate "no release" for those.`,
  );
  process.exit(0);
}

console.error(`✗ changeset coverage incomplete vs ${baseRef}.\n`);
console.error('  Changed source files:');
for (const f of sourceChanges) console.error(`    ${f}`);
if (changedDirs.has('core')) {
  console.error(
    '\n  packages/core is bundled into BOTH the server and the extension, so a core change\n' +
      `  must bump both ${SERVER} and ${EXTENSION}.`,
  );
}
console.error(`\n  Changesets bump: ${bumped.size ? [...bumped].join(', ') : '(none)'}`);
console.error(`  Still need a bump for: ${missing.join(', ')}`);
console.error('\n  Add/extend a changeset:  npx changeset   (select the missing package[s])');
console.error('  Release-irrelevant? Record it explicitly:  npx changeset add --empty\n');
process.exit(1);
