#!/usr/bin/env node
// Validates that a git tag — and, optionally, a GitHub release title — obey the
// repo's naming conventions (scripts/lib/release-naming.mjs) AND that the version
// they carry matches the package.json checked out at that ref.
//
// This is the CI backstop: even a tag or title created by hand (not via
// scripts/tag.mjs) is caught here. Run against the ref being validated:
//
//   node scripts/check-release-naming.mjs tag   <tag>
//   node scripts/check-release-naming.mjs title <tag> <title>
//
// In CI the working tree is checked out AT the tag's commit, so package.json
// carries the version the tag claims — that's the invariant we assert.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetOfTag } from './lib/release-naming.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const pkgVersion = (rel) => {
  const v = JSON.parse(readFileSync(join(root, rel), 'utf8')).version;
  if (!v) die(`no "version" in ${rel}`);
  return v;
};

const [mode, tag, ...rest] = process.argv.slice(2);
if (!mode || !tag) {
  die('usage: check-release-naming.mjs <tag|title> <tag> [title]');
}

const hit = targetOfTag(tag);
if (!hit) {
  die(
    `tag "${tag}" matches no cadence — must be "vX.Y.Z" (product) or "arc1-extension-vX.Y.Z" (extension). Create tags with: node scripts/tag.mjs <product|extension>`,
  );
}
const { target, version } = hit;

// The tag's version must equal the version committed at this ref.
const fileV = pkgVersion(target.versionFile);
if (version !== fileV) {
  die(
    `tag "${tag}" claims ${target.label} version ${version}, but ${target.versionFile} at this commit is ${fileV}. Tag the commit that carries the version.`,
  );
}

if (mode === 'tag') {
  console.log(`✓ tag "${tag}" is a valid ${target.label} tag and matches ${target.versionFile} (${fileV})`);
  process.exit(0);
}

if (mode === 'title') {
  const title = rest.join(' ');
  if (!title) die('title mode requires a title argument');
  const m = title.match(target.titleRe);
  if (!m) {
    const want = target.title(version);
    die(`release title "${title}" is not canonical for a ${target.label} release — expected "${want}"[ — headline]`);
  }
  if (m[1] !== version) {
    die(`release title version (${m[1]}) does not match tag version (${version})`);
  }
  console.log(`✓ release title "${title}" is canonical for ${tag}`);
  process.exit(0);
}

die(`unknown mode "${mode}" (expected: tag | title)`);
