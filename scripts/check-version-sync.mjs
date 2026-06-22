#!/usr/bin/env node
// Fails if a version drifts across files that must agree. Two independent
// invariants, on two independent release cadences:
//
//   1. PRODUCT version (vX.Y.Z — the git tag and the .mtar label). Carried by:
//        - package.json (root)
//        - packages/server/package.json
//        - mta.yaml
//
//   2. ARC-1 EXTENSION version (its own cadence — NOT the product version).
//      Carried by TWO sources that ARC-1 treats differently:
//        - packages/arc1-extension/package.json   (build metadata)
//        - packages/arc1-extension/src/index.ts   (`plugin.version` — the value
//          ARC-1 actually reads at load time and surfaces to its host/audit)
//      These can drift silently; that's the bug this guards.
//
// `@lisa/core` is deliberately NOT checked: it's private, never published, and
// consumed only via the `"*"` workspace range, so its `version` field is inert.
//
// Run standalone (`node scripts/check-version-sync.mjs`) or via `npm run
// check:version`. CI runs it on every PR, so drift can't be merged.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const pkgVersion = (rel) => {
  const v = JSON.parse(read(rel)).version;
  if (!v) throw new Error(`no "version" in ${rel}`);
  return v;
};

// mta.yaml's version is a single top-level scalar; a line match avoids pulling
// in a YAML parser for one field.
const mtaVersion = () => {
  const m = read('mta.yaml').match(/^version:\s*(.+?)\s*$/m);
  if (!m) throw new Error('no top-level `version:` in mta.yaml');
  return m[1];
};

// `plugin.version` in index.ts. `\bversion:` matches the `version` key but not
// `apiVersion:` (no word boundary before `version` inside `apiVersion`).
const pluginVersion = (rel) => {
  const m = read(rel).match(/\bversion:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error(`no \`version:\` in ${rel}`);
  return m[1];
};

const groups = [
  {
    label: 'product version (tag + .mtar)',
    sources: {
      'package.json': pkgVersion('package.json'),
      'packages/server/package.json': pkgVersion('packages/server/package.json'),
      'mta.yaml': mtaVersion(),
    },
    fix: './scripts/release.sh <version>',
  },
  {
    label: 'arc-1 extension version',
    sources: {
      'packages/arc1-extension/package.json': pkgVersion('packages/arc1-extension/package.json'),
      'packages/arc1-extension/src/index.ts': pluginVersion('packages/arc1-extension/src/index.ts'),
    },
    fix: 'set both to the same version',
  },
];

let failed = false;
for (const { label, sources, fix } of groups) {
  const versions = [...new Set(Object.values(sources))];
  if (versions.length === 1) {
    console.log(`✓ ${label}: ${versions[0]}`);
    continue;
  }
  failed = true;
  console.error(`✗ ${label} — these must all carry the same version:`);
  for (const [file, version] of Object.entries(sources)) {
    console.error(`    ${version.padEnd(12)} ${file}`);
  }
  console.error(`  fix: ${fix}\n`);
}

process.exit(failed ? 1 : 0);
