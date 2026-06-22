import { build } from 'esbuild';

// npm workspaces hoist @lisa/core into the repo-root node_modules as a symlink, which would not
// survive a naive "ship this folder" deploy artifact (BTP MTA / Docker). We bundle @lisa/core
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
