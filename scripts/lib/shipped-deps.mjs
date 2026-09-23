// What a DEPENDENCY change ships, per released artifact — used by
// scripts/require-changeset.mjs so a dependency bump (typically a Dependabot PR)
// can't merge without deciding whether it gets released.
//
// Two ways a dependency change reaches users:
//
//   1. Manifest ranges — the runtime fields of a PUBLISHED package.json ship in
//      the npm tarball: consumers resolve `dependencies` / `peerDependencies`
//      themselves. (`devDependencies` never ship.)
//
//   2. The lockfile — the Docker image and the BTP MTA both `npm ci` from THIS
//      repo's package-lock.json, so a change to any package in the server's
//      production closure ships in those artifacts even when no range moved
//      (e.g. an `npm audit fix` that only touches transitive versions).
//
// The ARC-1 extension has no lockfile exposure: its bundle inlines only
// @lisa-mcp/core, and arc-1 / zod are provided by the host.

/** Manifest fields whose content ships in a published package. */
export const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Runtime dependency entries that differ between two package.json objects.
 * Either side may be null (file absent). Returns human-readable lines.
 */
export function manifestRuntimeChanges(base, head) {
  const changes = [];
  for (const field of RUNTIME_FIELDS) {
    const a = base?.[field] ?? {};
    const b = head?.[field] ?? {};
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[name] === b[name]) continue;
      changes.push(`${field}.${name}: ${a[name] ?? '(none)'} → ${b[name] ?? '(removed)'}`);
    }
  }
  return changes;
}

// Resolve `name` as required from the package at lockfile path `from`, the way
// Node does: nearest node_modules/<name> walking up the directory chain.
function resolve(pkgs, from, name) {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (candidate in pkgs) return candidate;
    if (!dir) return null;
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
}

/**
 * The production dependency closure of the workspace at `rootPath` (e.g.
 * 'packages/server') in a lockfile v2/v3 object: Map<lockfile path, version>.
 * Follows dependencies, optional and peer deps (npm ≥ 7 installs peers);
 * never devDependencies. Unresolvable entries (absent optionals) are skipped.
 */
export function runtimeClosure(lock, rootPath) {
  const pkgs = lock?.packages ?? {};
  const closure = new Map();
  const root = pkgs[rootPath];
  if (!root) return closure;

  const queue = [rootPath];
  const visited = new Set([rootPath]);
  while (queue.length) {
    const from = queue.shift();
    const entry = pkgs[from];
    for (const field of RUNTIME_FIELDS) {
      for (const name of Object.keys(entry[field] ?? {})) {
        let path = resolve(pkgs, from, name);
        if (!path) continue;
        // Workspace symlinks: continue from the linked package's own entry.
        if (pkgs[path].link && pkgs[path].resolved) path = pkgs[path].resolved;
        if (visited.has(path) || !pkgs[path]) continue;
        visited.add(path);
        closure.set(path, pkgs[path].version ?? '(link)');
        queue.push(path);
      }
    }
  }
  return closure;
}

/**
 * Packages whose resolved version in the `rootPath` production closure differs
 * between two lockfiles. Returns human-readable lines, one per package.
 */
export function closureChanges(baseLock, headLock, rootPath) {
  const a = runtimeClosure(baseLock, rootPath);
  const b = runtimeClosure(headLock, rootPath);
  const nameOf = (path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const changes = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.get(path) === b.get(path)) continue;
    changes.push(`${nameOf(path)}: ${a.get(path) ?? '(none)'} → ${b.get(path) ?? '(removed)'}`);
  }
  return changes;
}
