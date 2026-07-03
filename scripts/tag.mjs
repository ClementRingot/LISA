#!/usr/bin/env node
// Create a release tag WITHOUT ever hand-typing its name or title. The tag and
// title are DERIVED from the version already committed in package.json, using
// the one convention in scripts/lib/release-naming.mjs — so a typo or a
// tag↔version drift is impossible by construction.
//
//   node scripts/tag.mjs product                       # → v0.8.5   / title "v0.8.5"
//   node scripts/tag.mjs extension                     # → arc1-extension-v0.2.0 / "lisa-arc1-extension v0.2.0"
//   node scripts/tag.mjs product --headline "Batch X"  # title "v0.8.5 — Batch X"
//   node scripts/tag.mjs extension --push              # also `git push origin <tag>`
//   node scripts/tag.mjs product --push --release      # …and create the GitHub release with the canonical title
//
// It refuses to run on a dirty tree, warns off `main`, and refuses to clobber an
// existing tag. It does NOT bump versions — that's Changesets' job
// (`npm run changeset:version`); this only tags the commit that already carries
// the bumped version.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, names } from './lib/release-naming.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const err = (m) => {
  console.error(`\x1b[31m✗ ${m}\x1b[0m`);
  process.exit(1);
};
const ok = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const info = (m) => console.log(`\x1b[36m• ${m}\x1b[0m`);

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const key = argv[0];
if (!TARGETS[key]) err('usage: node scripts/tag.mjs <product|extension> [--headline "…"] [--push] [--release]');
const target = TARGETS[key];
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const headline = opt('--headline');
const doPush = flag('--push');
const doRelease = flag('--release');

// ── resolve version + canonical names ───────────────────────────────────────
const version = JSON.parse(readFileSync(join(root, target.versionFile), 'utf8')).version;
if (!version) err(`no "version" in ${target.versionFile}`);
const { tag, title } = names(key, version, headline);

// ── safety rails ────────────────────────────────────────────────────────────
if (git('status', '--porcelain'))
  err('working tree not clean — commit or stash first (tag must point at a committed version)');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') info(`warning: tagging from "${branch}", not "main"`);
try {
  git('rev-parse', tag);
  err(`tag ${tag} already exists`);
} catch {
  /* good — tag is free */
}

// Cross-check the whole cadence agrees before we immortalise it as a tag.
try {
  execFileSync('node', ['scripts/check-version-sync.mjs'], { cwd: root, stdio: 'pipe' });
} catch (e) {
  process.stderr.write(e.stdout ?? '');
  process.stderr.write(e.stderr ?? '');
  err('version-sync check failed — fix drift before tagging');
}

// ── create the annotated tag (message = canonical title) ────────────────────
git('tag', '-a', tag, '-m', title);
ok(`created ${target.label} tag ${tag}  (title: "${title}")`);

if (doPush) {
  git('push', 'origin', tag);
  ok(`pushed ${tag}`);
} else {
  info(`review, then: git push origin ${tag}`);
}

// ── optional: create the GitHub release with the canonical title ────────────
if (doRelease) {
  if (!doPush) err('--release requires --push (the tag must exist on the remote first)');
  const remote = git('remote', 'get-url', 'origin');
  const tokenMatch = remote.match(/^https:\/\/([^@]+)@/);
  if (!tokenMatch) err('could not extract a token from the origin URL — push the tag and create the release manually');
  const token = tokenMatch[1].replace(/^.*:/, ''); // handle user:token form
  const repo = remote.replace(/^https:\/\/[^@]+@github\.com\//, '').replace(/\.git$/, '');
  const body = JSON.stringify({ tag_name: tag, name: title, body: `${title}\n` });
  const res = execFileSync(
    'curl',
    [
      '-sS',
      '-X',
      'POST',
      '-H',
      `Authorization: token ${token}`,
      '-H',
      'Accept: application/vnd.github+json',
      `https://api.github.com/repos/${repo}/releases`,
      '-d',
      body,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const json = JSON.parse(res);
  if (json.html_url) ok(`created release: ${json.html_url}`);
  else err(`release creation failed: ${json.message ?? res}`);
}

if (!doPush) {
  console.log('\nNext:');
  console.log(`  git push origin ${tag}`);
  console.log(`  # then create the release titled exactly:  ${title}`);
}
