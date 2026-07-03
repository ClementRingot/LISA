import { build } from 'esbuild';

// ARC-1 loads a code plugin as a SINGLE .js file and cannot resolve workspace symlinks
// (@lisa/core) or the plugin's runtime node_modules. We bundle @lisa/core straight into
// dist/index.js and keep external only the two packages the host ARC-1 process provides:
//   - arc-1/public → resolved via ARC-1's package self-reference (defineTool / OperationType).
//   - zod          → MUST stay the host's instance: ARC-1's registry runs z.toJSONSchema() on
//                    the tool schemas, so plugin and registry have to share one zod instance.
// Mirrors packages/server/esbuild.config.mjs.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [
    'arc-1/public', // provided by the host ARC-1 process at runtime
    'zod', // must resolve to ARC-1's own zod (shared registry instance)
  ],
});
