import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closureChanges, manifestRuntimeChanges, runtimeClosure } from './shipped-deps.mjs';

// A minimal lockfile v3 shaped like this repo's: a server workspace with runtime
// and dev deps, a nested (non-hoisted) copy, a workspace link, and a peer dep.
function lockfile(overrides = {}) {
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'lisa', workspaces: ['packages/core', 'packages/server'] },
      'packages/server': {
        name: '@lisa-mcp/server',
        version: '0.9.3',
        dependencies: { express: '^5.1.0', undici: '^8.4.0' },
        devDependencies: { typescript: '^6.0.3', '@lisa-mcp/core': '*' },
      },
      'packages/core': { name: '@lisa-mcp/core', version: '0.1.0', dependencies: { zod: '^4.3.6' } },
      'node_modules/@lisa-mcp/core': { resolved: 'packages/core', link: true },
      'node_modules/express': {
        version: '5.1.0',
        dependencies: { 'body-parser': '^2.2.0', debug: '^4.4.0' },
        peerDependencies: { 'peer-thing': '^1.0.0' },
      },
      'node_modules/express/node_modules/debug': { version: '4.4.3' },
      'node_modules/debug': { version: '3.2.7', dev: true },
      'node_modules/body-parser': { version: '2.2.0' },
      'node_modules/peer-thing': { version: '1.0.0' },
      'node_modules/undici': { version: '8.7.0' },
      'node_modules/typescript': { version: '6.0.3', dev: true },
      'node_modules/zod': { version: '4.3.6' },
    },
  };
  Object.assign(lock.packages, overrides);
  return lock;
}

describe('runtimeClosure', () => {
  const closure = runtimeClosure(lockfile(), 'packages/server');

  it('follows runtime and peer deps, transitively', () => {
    assert.deepEqual([...closure.keys()].sort(), [
      'node_modules/body-parser',
      'node_modules/express',
      'node_modules/express/node_modules/debug',
      'node_modules/peer-thing',
      'node_modules/undici',
    ]);
  });

  it('resolves the nearest nested copy, like Node does', () => {
    assert.equal(closure.get('node_modules/express/node_modules/debug'), '4.4.3');
    assert.equal(closure.has('node_modules/debug'), false);
  });

  it('never follows devDependencies (so the inlined core and its deps stay out)', () => {
    assert.equal(closure.has('node_modules/typescript'), false);
    assert.equal(closure.has('packages/core'), false);
    assert.equal(closure.has('node_modules/zod'), false);
  });

  it('is empty for an unknown workspace', () => {
    assert.equal(runtimeClosure(lockfile(), 'packages/nope').size, 0);
  });
});

describe('closureChanges', () => {
  it('flags a transitive-only bump (the npm audit fix case)', () => {
    const head = lockfile({ 'node_modules/body-parser': { version: '2.2.1' } });
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), ['body-parser: 2.2.0 → 2.2.1']);
  });

  it('ignores a dev-only bump', () => {
    const head = lockfile({ 'node_modules/typescript': { version: '6.1.0', dev: true } });
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), []);
  });

  it('ignores the workspace version bump of a version PR', () => {
    const head = lockfile();
    head.packages['packages/server'] = { ...head.packages['packages/server'], version: '0.9.4' };
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), []);
  });

  it('reports added and removed packages', () => {
    const head = lockfile({
      'node_modules/express': { version: '5.2.0', dependencies: { 'body-parser': '^2.2.0', qs: '^6.0.0' } },
      'node_modules/qs': { version: '6.14.0' },
    });
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), [
      'debug: 4.4.3 → (removed)',
      'express: 5.1.0 → 5.2.0',
      'peer-thing: 1.0.0 → (removed)',
      'qs: (none) → 6.14.0',
    ]);
  });

  it('ignores npm re-hoisting a package at the same version', () => {
    // debug 4.4.3 moves from express's nested node_modules up to the root.
    const head = lockfile({ 'node_modules/debug': { version: '4.4.3' } });
    delete head.packages['node_modules/express/node_modules/debug'];
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), []);
  });

  it('lists every version of a package installed at several', () => {
    const head = lockfile({
      'node_modules/undici': { version: '8.10.0' },
      'node_modules/body-parser': { version: '2.2.0', dependencies: { undici: '^7.0.0' } },
      'node_modules/body-parser/node_modules/undici': { version: '7.16.0' },
    });
    assert.deepEqual(closureChanges(lockfile(), head, 'packages/server'), ['undici: 8.7.0 → 7.16.0, 8.10.0']);
  });
});

describe('manifestRuntimeChanges', () => {
  it('reports runtime range changes and ignores devDependencies', () => {
    const base = { dependencies: { dotenv: '^16.4.5' }, devDependencies: { vitest: '^3.0.0' } };
    const head = { dependencies: { dotenv: '^17.4.2' }, devDependencies: { vitest: '^4.1.9' } };
    assert.deepEqual(manifestRuntimeChanges(base, head), ['dependencies.dotenv: ^16.4.5 → ^17.4.2']);
  });

  it('covers peerDependencies (the extension ships its peer range)', () => {
    const base = { peerDependencies: { 'arc-1': '>=0.9.20' } };
    const head = { peerDependencies: { 'arc-1': '>=1.0.0' } };
    assert.deepEqual(manifestRuntimeChanges(base, head), ['peerDependencies.arc-1: >=0.9.20 → >=1.0.0']);
  });

  it('ignores a version-field-only change', () => {
    assert.deepEqual(manifestRuntimeChanges({ version: '0.9.3' }, { version: '0.9.4' }), []);
  });

  it('handles an absent manifest on either side', () => {
    assert.deepEqual(manifestRuntimeChanges(null, { dependencies: { a: '1' } }), ['dependencies.a: (none) → 1']);
  });
});
