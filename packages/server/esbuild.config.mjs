import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// The server's own version, baked into the bundle (see src/server/version.ts).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// npm workspaces hoist @lisa-mcp/core into the repo-root node_modules as a symlink, which would not
// survive a naive "ship this folder" deploy artifact (BTP MTA / Docker). We bundle @lisa-mcp/core
// straight into dist/index.js and keep every real npm dependency external (already present in
// node_modules at runtime via the standard "npm ci && npm prune --omit=dev" deploy flow).
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // dist/index.js is also the package's `bin` (npx @lisa-mcp/server) — it needs
  // a shebang to be executable when npm links it.
  banner: { js: '#!/usr/bin/env node' },
  define: { __LISA_VERSION__: JSON.stringify(version) },
  external: [
    '@arc-mcp/xsuaa-auth',
    '@arc-mcp/xsuaa-auth/btp',
    '@modelcontextprotocol/sdk',
    '@modelcontextprotocol/sdk/*',
    'cors',
    'dotenv',
    'express',
    'express-rate-limit',
    'helmet',
    'jose',
    'undici',
    'zod',
  ],
});
