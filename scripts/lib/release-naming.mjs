// Single source of truth for this repo's tag + release-title conventions.
//
// Two independent release cadences (see check-version-sync.mjs):
//
//   target      version source                       git tag                     release title
//   ─────────   ──────────────────────────────────   ─────────────────────────   ────────────────────────────
//   product     package.json (root)                  vX.Y.Z                      vX.Y.Z              [ — headline]
//   extension   packages/arc1-extension/package.json arc1-extension-vX.Y.Z       lisa-arc1-extension vX.Y.Z [ — …]
//
// The extension's *title* prefix (`lisa-arc1-extension`) deliberately differs
// from its *tag* prefix (`arc1-extension-v`) — both are pinned here so the tag
// generator and the CI validator can never disagree. Change a convention here
// and both sides move together.

const SEMVER = String.raw`\d+\.\d+\.\d+`;

/** @typedef {'product' | 'extension'} TargetKey */

export const TARGETS = {
  product: {
    key: 'product',
    label: 'product',
    versionFile: 'package.json',
    tag: (v) => `v${v}`,
    title: (v) => `v${v}`,
    tagRe: new RegExp(`^v(${SEMVER})$`),
    titleRe: new RegExp(`^v(${SEMVER})(?: — .+)?$`),
  },
  extension: {
    key: 'extension',
    label: 'arc-1 extension',
    versionFile: 'packages/arc1-extension/package.json',
    tag: (v) => `arc1-extension-v${v}`,
    title: (v) => `lisa-arc1-extension v${v}`,
    tagRe: new RegExp(`^arc1-extension-v(${SEMVER})$`),
    titleRe: new RegExp(`^lisa-arc1-extension v(${SEMVER})(?: — .+)?$`),
  },
};

/**
 * Resolve which cadence a tag belongs to. The two tag regexes are mutually
 * exclusive (a product tag starts with `v<digit>`, an extension tag with `a`),
 * so order is irrelevant.
 * @param {string} tag
 * @returns {{ target: typeof TARGETS[TargetKey], version: string } | null}
 */
export function targetOfTag(tag) {
  for (const target of Object.values(TARGETS)) {
    const m = tag.match(target.tagRe);
    if (m) return { target, version: m[1] };
  }
  return null;
}

/**
 * Build the canonical tag + title for a target/version, with an optional
 * headline appended to the title (never to the tag).
 * @param {TargetKey} key
 * @param {string} version  bare semver, e.g. "0.2.0"
 * @param {string} [headline]
 */
export function names(key, version, headline) {
  const target = TARGETS[key];
  if (!target) throw new Error(`unknown target "${key}" (expected: product | extension)`);
  if (!new RegExp(`^${SEMVER}$`).test(version)) {
    throw new Error(`version must be bare semver X.Y.Z (got: "${version}")`);
  }
  const suffix = headline ? ` — ${headline}` : '';
  return { tag: target.tag(version), title: target.title(version) + suffix };
}

export { SEMVER };
