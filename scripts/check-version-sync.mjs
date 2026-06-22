#!/usr/bin/env node
// Fails if the product version drifts across the files that must agree.
//
// LISA tags one product version (vX.Y.Z). Three files carry it and MUST match:
//   - package.json            (root, the npm/workspace version)
//   - packages/server/package.json (the deployable server)
//   - mta.yaml                (the `.mtar` label baked into the CF artifact)
//
// `@lisa/core` and `lisa-arc1-extension` are versioned independently (they are
// separate distributions), so they are deliberately NOT checked here.
//
// Run standalone (`node scripts/check-version-sync.mjs`) or via `npm run
// check:version`. Wire it into CI to make version drift impossible to merge.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkgVersion = (rel) => {
  const v = JSON.parse(readFileSync(join(root, rel), 'utf8')).version;
  if (!v) throw new Error(`no "version" in ${rel}`);
  return v;
};

// mta.yaml is YAML but the version is a single top-level scalar; a line match
// avoids pulling in a YAML parser for one field.
const mtaVersion = () => {
  const m = readFileSync(join(root, 'mta.yaml'), 'utf8').match(/^version:\s*(.+?)\s*$/m);
  if (!m) throw new Error('no top-level `version:` in mta.yaml');
  return m[1];
};

const sources = {
  'package.json': pkgVersion('package.json'),
  'packages/server/package.json': pkgVersion('packages/server/package.json'),
  'mta.yaml': mtaVersion(),
};

const versions = [...new Set(Object.values(sources))];

if (versions.length === 1) {
  console.log(`✓ version in sync: ${versions[0]}`);
  process.exit(0);
}

console.error('✗ version drift — these files must all carry the same version:');
for (const [file, version] of Object.entries(sources)) {
  console.error(`    ${version.padEnd(12)} ${file}`);
}
console.error('\nFix with: ./scripts/release.sh <version>   (or edit the files to match)');
process.exit(1);
