#!/usr/bin/env node
// The `publish` step of .github/workflows/changesets.yml — runs on a push to
// main that has NO pending changesets (i.e. right after a "Version Packages"
// PR merges, when the committed versions are the release).
//
// For each release cadence (product / extension) it checks whether the
// CANONICAL tag for the committed version already exists on origin, and if
// not, creates and pushes it via scripts/tag.mjs (which derives the tag name
// from the committed version — never hand-typed — and re-runs the
// version-sync check first).
//
// The pushed tag then triggers the existing publish pipelines
// (release-product.yml / publish-extension.yml), which npm-publish and cut
// the GitHub release. NOTE: for that trigger to fire, the tag must be pushed
// with a PAT (see the workflow) — tags pushed with the default GITHUB_TOKEN
// do not trigger workflows (GitHub's recursive-workflow prevention).
//
// Idempotent: a tag that already exists on origin is skipped, so re-runs and
// docs-only merges are no-ops.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './lib/release-naming.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

let failed = false;
for (const target of Object.values(TARGETS)) {
  const version = JSON.parse(readFileSync(join(root, target.versionFile), 'utf8')).version;
  const tag = target.tag(version);

  if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`) !== '') {
    console.log(`✓ ${target.label}: ${tag} already on origin — nothing to do`);
    continue;
  }

  console.log(`• ${target.label}: tagging ${tag}…`);
  try {
    execFileSync('node', ['scripts/tag.mjs', target.key, '--push'], { cwd: root, stdio: 'inherit' });
  } catch {
    failed = true; // keep going: one cadence failing must not block the other
  }
}

process.exit(failed ? 1 : 0);
