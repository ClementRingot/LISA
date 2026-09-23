/**
 * Single source of truth for the server version.
 *
 * The bundle build (esbuild.config.mjs) injects the version from this
 * package's own package.json as `__LISA_VERSION__`, so every way of running
 * dist/index.js reports the real version: `npm start` on BTP, `node …` in the
 * Docker image, and `npx @lisa-mcp/server`. (Relying on `npm_package_version`
 * alone reported a stale literal outside npm scripts, and under npx it is the
 * CALLER's project version, not ours.)
 *
 * Unbundled runs (`npm run dev` via tsx, vitest) have no injected value and
 * fall back to npm's variable, then to an explicit dev marker.
 */
declare const __LISA_VERSION__: string | undefined;

export const VERSION: string =
  typeof __LISA_VERSION__ === 'string' ? __LISA_VERSION__ : (process.env.npm_package_version ?? '0.0.0-dev');
