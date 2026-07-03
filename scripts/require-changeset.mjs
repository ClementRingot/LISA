#!/usr/bin/env node
// CI guard: a PR that changes shipped package source MUST carry a changeset, so
// a version bump can never be silently forgotten (the exact failure that let the
// ARC-1 extension sit at 0.1.0 across several `feat` commits).
//
// Logic: diff against the base ref. If any non-test file under `packages/*/src/**`
// changed, at least one new changeset (`.changeset/*.md`, excluding README.md and
// config.json) must be present in the same diff. Otherwise fail with guidance.
//
// Escape hatch: for a genuinely release-irrelevant source change (pure comments,
// a build-only tweak), add an EMPTY changeset — `npx changeset add --empty` — which
// records the deliberate "no release" decision and satisfies this check.
//
// Base ref: arg 1, or $CHANGESET_BASE_REF, or origin/main.

import { execFileSync } from 'node:child_process';

const baseRef = process.argv[2] || process.env.CHANGESET_BASE_REF || 'origin/main';

function diffNames(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

let files;
try {
  files = diffNames(baseRef);
} catch {
  // Fallback for shallow checkouts where the three-dot merge-base is unavailable.
  files = execFileSync('git', ['diff', '--name-only', baseRef], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

const isPackageSource = (f) => /^packages\/[^/]+\/src\/.+/.test(f) && !/\.test\.ts$/.test(f) && !/\.test\.tsx$/.test(f);

const isChangeset = (f) => f.startsWith('.changeset/') && f.endsWith('.md') && !f.endsWith('/README.md');

const sourceChanges = files.filter(isPackageSource);
const changesets = files.filter(isChangeset);

if (sourceChanges.length === 0) {
  console.log(`✓ no shipped package source changed vs ${baseRef} — changeset not required`);
  process.exit(0);
}

if (changesets.length > 0) {
  console.log(`✓ package source changed and ${changesets.length} changeset(s) present`);
  process.exit(0);
}

console.error(`✗ package source changed vs ${baseRef} but NO changeset was added.\n`);
console.error('  Changed source files:');
for (const f of sourceChanges) console.error(`    ${f}`);
console.error('\n  Add one with:  npx changeset');
console.error('  (choose the affected package + bump level; it writes the CHANGELOG at release time)');
console.error('  Release-irrelevant change? Record it explicitly:  npx changeset add --empty\n');
process.exit(1);
