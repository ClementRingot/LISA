#!/usr/bin/env node
// CI guard: a PR that changes what a released package SHIPS must carry a
// changeset that bumps the RIGHT package(s), so a version bump can never be
// silently forgotten (the failure that let the ARC-1 extension sit at 0.1.0
// across several `feat`s — and that left the 0.9.3 security patches unreleased
// until a changeset was added by hand).
//
// What counts as a shipped change, and which package it requires:
//
//   - package source — non-test files under `packages/*/src/**`:
//        packages/server/src         → `@lisa-mcp/server`
//        packages/arc1-extension/src → `@lisa-mcp/arc1-extension`
//        packages/core/src           → BOTH, because `@lisa-mcp/core` is
//          bundled/inlined into both artifacts. (`@lisa-mcp/core` is ignored by
//          Changesets, so you never write a changeset for it — you bump its two
//          dependents.)
//   - runtime dependency ranges — dependencies / optionalDependencies /
//     peerDependencies in packages/server or packages/arc1-extension
//     package.json (they ship in the npm tarball; devDependencies don't).
//   - the lockfile — any version change in the server's production closure
//     (the Docker image and the BTP MTA `npm ci` from it), even with no range
//     change: an `npm audit fix` or a Dependabot transitive bump.
//   - the Dockerfile — it IS the ghcr.io image, released with the product.
//
// Two rules, checked against the base ref:
//   1. Base — any shipped change requires at least one changeset
//      (`.changeset/*.md`, excluding README.md).
//   2. Coverage — the changesets must bump every package listed above for the
//      changes present.
//
// Escape hatch: a genuinely release-irrelevant change (pure comments, a
// build-only tweak, a bump you don't want to release yet) is declared with an
// EMPTY changeset — `npx changeset add --empty` — which satisfies both rules
// with a loud note.
//
// Base ref: arg 1, or $CHANGESET_BASE_REF, or origin/main.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { closureChanges, manifestRuntimeChanges } from './lib/shipped-deps.mjs';

const baseRef = process.argv[2] || process.env.CHANGESET_BASE_REF || 'origin/main';

const SERVER = '@lisa-mcp/server';
const EXTENSION = '@lisa-mcp/arc1-extension';

// Map a changed package directory (basename under packages/) to the released
// package name(s) that must be bumped for it. `core` fans out to both dependents.
const DIR_TO_REQUIRED = {
  server: [SERVER],
  'arc1-extension': [EXTENSION],
  core: [SERVER, EXTENSION],
};

// Published manifests whose runtime dependency ranges ship in the npm tarball.
const PUBLISHED_MANIFESTS = {
  'packages/server/package.json': SERVER,
  'packages/arc1-extension/package.json': EXTENSION,
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// The commit the PR branched from; falls back to the base ref itself for
// shallow checkouts where the merge-base is unavailable.
function mergeBase(base) {
  try {
    return git('merge-base', base, 'HEAD').trim();
  } catch {
    return base;
  }
}

// `--name-status` so a DELETED changeset (a version PR consuming it) is
// distinguishable from an ADDED one — reading a deleted path would ENOENT.
// Rename lines are `R<score>\told\tnew`; the last field is the current path.
function diffEntries(base) {
  return git('diff', '--name-status', base, 'HEAD')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
}

// A JSON file as of the base commit and as of HEAD (null when absent).
function jsonAt(base, path) {
  let before = null;
  try {
    before = JSON.parse(git('show', `${base}:${path}`));
  } catch {}
  const after = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  return [before, after];
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

const base = mergeBase(baseRef);
const entries = diffEntries(base);
const changedPaths = new Set(entries.map((e) => e.path));

// ── Collect every shipped change, with the package(s) it requires ──────────
// Each finding: { what, requires: [pkg, …] }.
const findings = [];

for (const f of [...changedPaths].filter(isPackageSource)) {
  findings.push({ what: `source   ${f}`, requires: DIR_TO_REQUIRED[pkgDirOf(f)] ?? [] });
}

for (const [manifest, pkg] of Object.entries(PUBLISHED_MANIFESTS)) {
  if (!changedPaths.has(manifest)) continue;
  for (const change of manifestRuntimeChanges(...jsonAt(base, manifest))) {
    findings.push({ what: `range    ${manifest}  ${change}`, requires: [pkg] });
  }
}

if (changedPaths.has('package-lock.json')) {
  for (const change of closureChanges(...jsonAt(base, 'package-lock.json'), 'packages/server')) {
    findings.push({ what: `lockfile server runtime closure  ${change}`, requires: [SERVER] });
  }
}

if (changedPaths.has('Dockerfile')) {
  findings.push({ what: 'image    Dockerfile (the ghcr.io image ships with the product)', requires: [SERVER] });
}

// Added/modified changesets are the PR's declared bumps; deleted ones were
// CONSUMED by `changeset version` (a version PR) and no longer exist on disk.
const changesetPaths = entries.filter((e) => isChangeset(e.path) && e.status !== 'D').map((e) => e.path);
const consumedChangesets = entries.filter((e) => isChangeset(e.path) && e.status === 'D').map((e) => e.path);

const printFindings = (out) => {
  out('  Shipped changes:');
  for (const f of findings) out(`    ${f.what}`);
};

if (findings.length === 0) {
  console.log(`✓ nothing shipped changed vs ${baseRef} — changeset not required`);
  process.exit(0);
}

// A version PR (`npm run changeset:version`) deletes the changesets it applies
// and touches shipped files only through the version mirrors (e.g. the
// extension's `plugin.version` in src/index.ts, the lockfile's workspace
// versions). That's the release itself — no new changeset is required.
if (changesetPaths.length === 0 && consumedChangesets.length > 0) {
  console.log(
    `✓ version PR: ${consumedChangesets.length} changeset(s) consumed by \`changeset version\` — no new changeset required`,
  );
  process.exit(0);
}

// Rule 1 — a changeset must exist.
if (changesetPaths.length === 0) {
  console.error(`✗ shipped content changed vs ${baseRef} but NO changeset was added.\n`);
  printFindings(console.error);
  console.error('\n  Add one with:  npx changeset');
  console.error('  (choose the affected package + bump level; it writes the CHANGELOG at release time)');
  console.error('  Not releasing this (yet)? Record it explicitly:  npx changeset add --empty\n');
  process.exit(1);
}

// Rule 2 — which released packages must the changesets bump, given what changed?
const required = new Set(findings.flatMap((f) => f.requires));

// What do the PR's changesets actually bump?
const parsed = changesetPaths.map(parseChangeset);
const bumped = new Set(parsed.flatMap((c) => c.packages));
const hasEmpty = parsed.some((c) => c.empty);

const missing = [...required].filter((pkg) => !bumped.has(pkg));

if (missing.length === 0) {
  console.log(`✓ shipped content changed and changesets bump all required packages: ${[...required].join(', ')}`);
  process.exit(0);
}

// Missing coverage. An explicit empty changeset is the sanctioned opt-out.
if (hasEmpty) {
  console.log(
    `⚠ shipped content changed without bumping ${missing.join(', ')}, but an EMPTY changeset is present — treating as a deliberate "no release" for those.`,
  );
  process.exit(0);
}

console.error(`✗ changeset coverage incomplete vs ${baseRef}.\n`);
printFindings(console.error);
if (findings.some((f) => f.what.startsWith('source   packages/core/'))) {
  console.error(
    '\n  packages/core is bundled into BOTH the server and the extension, so a core change\n' +
      `  must bump both ${SERVER} and ${EXTENSION}.`,
  );
}
console.error(`\n  Changesets bump: ${bumped.size ? [...bumped].join(', ') : '(none)'}`);
console.error(`  Still need a bump for: ${missing.join(', ')}`);
console.error('\n  Add/extend a changeset:  npx changeset   (select the missing package[s])');
console.error('  Not releasing this (yet)? Record it explicitly:  npx changeset add --empty\n');
process.exit(1);
