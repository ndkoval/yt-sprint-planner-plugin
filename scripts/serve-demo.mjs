/**
 * serve-demo — bundle the demo harness (real widgets + real backend + in-memory
 * YouTrack) and serve it on DEMO_PORT (default 8090). Used both standalone
 * (`npm run demo:serve`) and as Playwright's `webServer` command for the demo E2E suite.
 *
 * The harness is TypeScript importing the backend/domain via `.js` ESM specifiers, so we
 * esbuild-bundle it to a runnable module first (no global tsc dependency).
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './lib/paths.mjs';
import { runMain } from './lib/log.mjs';

runMain('serve-demo', async (log) => {
  const port = Number(process.env.DEMO_PORT ?? 8090);
  const outfile = path.join(REPO_ROOT, 'dist', 'demo', 'mock-server.mjs');
  await mkdir(path.dirname(outfile), { recursive: true });

  log.step('bundle demo harness');
  await build({
    entryPoints: [path.join(REPO_ROOT, 'tests', 'e2e', 'harness', 'mock-server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    logLevel: 'warning',
    // Keep node built-ins external (platform:node handles that); bundle src + zod.
  });
  log.info('bundled ->', outfile);

  log.step(`start server on :${port}`);
  process.env.DEMO_WIDGETS_DIR = path.join(REPO_ROOT, 'dist', 'widgets');
  const mod = await import(pathToFileURL(outfile).href);
  const handle = await mod.startMockServer(port);

  // Keep the process alive until signalled; close cleanly so ports free for reruns.
  const shutdown = async () => {
    try {
      await handle.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Never resolve — the server owns the process lifetime.
  await new Promise(() => {});
});
