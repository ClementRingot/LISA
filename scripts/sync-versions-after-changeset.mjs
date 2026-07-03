#!/usr/bin/env node
// Post-`changeset version` mirror sync.
//
// Changesets bumps the versions inside each workspace `package.json`, but LISA
// carries the SAME version in extra files that are NOT workspace packages and
// that `scripts/check-version-sync.mjs` guards. After every `changeset version`
// we copy the freshly-bumped versions into those mirror files so the sync check
// stays green in one shot:
//
//   product version   (packages/server/package.json)
//     → package.json (root)     — the .mtar label source
//     → mta.yaml                — the top-level `version:` scalar
//
//   extension version (packages/arc1-extension/package.json)
//     → packages/arc1-extension/src/index.ts  — `plugin.version`, the value
//        ARC-1 reads at load time and surfaces to its host/audit
//
// `@lisa-mcp/core` is deliberately ignored by changesets (private, inert) and has no
// mirror, so it is not handled here.
//
// Run via the `changeset:version` npm script, right after `changeset version`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = (rel) => join(root, rel);
const readJson = (rel) => JSON.parse(readFileSync(path(rel), 'utf8'));

const productVersion = readJson('packages/server/package.json').version;
const extensionVersion = readJson('packages/arc1-extension/package.json').version;

let changed = false;
const note = (rel, from, to) => {
  if (from !== to) {
    changed = true;
    console.log(`  ${rel}: ${from} → ${to}`);
  }
};

// ── root package.json → product version ─────────────────────────────────────
{
  const rel = 'package.json';
  const json = readJson(rel);
  note(rel, json.version, productVersion);
  json.version = productVersion;
  writeFileSync(path(rel), `${JSON.stringify(json, null, 2)}\n`);
}

// ── mta.yaml → product version (top-level `version:` scalar only) ───────────
{
  const rel = 'mta.yaml';
  const src = readFileSync(path(rel), 'utf8');
  const m = src.match(/^version:\s*(.+?)\s*$/m);
  if (!m) throw new Error('no top-level `version:` in mta.yaml');
  note(rel, m[1], productVersion);
  writeFileSync(path(rel), src.replace(/^version:\s*.+$/m, `version: ${productVersion}`));
}

// ── src/index.ts → extension `plugin.version` ──────────────────────────────
{
  const rel = 'packages/arc1-extension/src/index.ts';
  const src = readFileSync(path(rel), 'utf8');
  const m = src.match(/(\bversion:\s*)(['"])([^'"]+)\2/);
  if (!m) throw new Error(`no \`version:\` string literal in ${rel}`);
  note(rel, m[3], extensionVersion);
  writeFileSync(path(rel), src.replace(/(\bversion:\s*)(['"])([^'"]+)\2/, `$1$2${extensionVersion}$2`));
}

console.log(changed ? '✓ mirror files synced' : '✓ mirror files already in sync');
