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
  // Root-level file: YouTrack discovers HTTP handlers from top-level package scripts and
  // derives the handler name from the file name — so `backend.js` → handler `backend`,
  // reachable at /api/extensionEndpoints/<app>/backend/<endpoint>.
  const outfile = path.join(DIST_DIR, 'backend.js');
  log.info('bundling', entry, '->', outfile);

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    // 'neutral' so esbuild assumes NO Node runtime — YouTrack's app backend engine has
    // no `process`/`Buffer`/etc. We provide the few globals the bundle needs via `banner`.
    platform: 'neutral',
    format: 'cjs',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    // zod is bundled (NOT external). The YouTrack workflow API modules are provided by the
    // runtime via require() and MUST stay external so they resolve inside YouTrack.
    external: ['@jetbrains/youtrack-scripting-api', '@jetbrains/youtrack-scripting-api/*'],
    define: { 'process.env.NODE_ENV': '"production"' },
    // Minimal shims for globals the YouTrack app runtime doesn't provide. `process` is
    // referenced transitively (e.g. by bundled deps); define a stub so module load
    // doesn't throw ReferenceError. Extend here if other globals surface.
    banner: {
      js: "var process = (typeof globalThis !== 'undefined' && globalThis.process) || { env: { NODE_ENV: 'production' }, platform: '', version: '' };",
    },
    logLevel: 'info',
  });

  log.info('backend bundle written');
});
