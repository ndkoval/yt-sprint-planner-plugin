/**
 * build:backend — bundle the backend entry point into dist/backend/index.js.
 *
 * SPIKE: confirm backend module format. YouTrack Apps run the backend inside a
 * server-side JS runtime (Rhino/Nashorn-style per the Apps SDK). CommonJS (`cjs`)
 * with `exports.httpHandler` is the safest assumption for that runtime, and
 * src/backend/index.ts already assigns `export const httpHandler` which esbuild
 * lowers to `exports.httpHandler` under cjs. If the SDK turns out to require ESM,
 * flip `format` to 'esm' here — nothing else in the pipeline depends on it.
 *
 * zod is bundled in (not marked external) so the backend has no runtime deps.
 */
import { build } from 'esbuild';
import { runMain } from './lib/log.mjs';
import { fromRoot, DIST_DIR } from './lib/paths.mjs';
import path from 'node:path';

runMain('build:backend', async (log) => {
  const entry = fromRoot('src', 'backend', 'index.ts');
  const outfile = path.join(DIST_DIR, 'backend', 'index.js');
  log.info('bundling', entry, '->', outfile);

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    // SPIKE: confirm backend module format (see file header). cjs assumed.
    format: 'cjs',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    // zod is bundled (NOT external) so the backend ships self-contained.
    external: [],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });

  log.info('backend bundle written');
});
