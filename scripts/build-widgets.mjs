/**
 * build:widgets — bundle each src/widgets/<name>/index.tsx into
 * dist/widgets/<name>/index.js and copy the matching index.html.
 *
 * esbuild options per spec: format esm, bundle, minify, jsx=automatic,
 * external=none, define process.env.NODE_ENV="production".
 *
 * TOLERANCE: the widgets sources are authored by another workstream and may not
 * exist yet. Missing index.tsx entries are logged and skipped (NOT a hard error)
 * so the backend build + packaging still verify. Once widgets land, the same
 * script bundles them with no changes.
 */
import { build } from 'esbuild';
import { readdir, mkdir, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { fromRoot, DIST_DIR } from './lib/paths.mjs';

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Discover widget directories under src/widgets that contain an index.tsx. */
async function discoverWidgets(log) {
  const widgetsDir = fromRoot('src', 'widgets');
  if (!(await exists(widgetsDir))) {
    log.warn('src/widgets does not exist yet — skipping widget bundling');
    return [];
  }
  const entries = await readdir(widgetsDir, { withFileTypes: true });
  const widgets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryTsx = path.join(widgetsDir, entry.name, 'index.tsx');
    if (await exists(entryTsx)) {
      widgets.push({ name: entry.name, entryTsx, dir: path.join(widgetsDir, entry.name) });
    }
    // Directories without an index.tsx (e.g. `components/`, shared code) are not
    // widget entry points — skip silently.
  }
  return widgets;
}

runMain('build:widgets', async (log) => {
  const widgets = await discoverWidgets(log);
  if (widgets.length === 0) {
    log.warn('no widget entry points found — nothing to bundle (this is OK before widgets land)');
    return;
  }

  for (const widget of widgets) {
    const outdir = path.join(DIST_DIR, 'widgets', widget.name);
    const outfile = path.join(outdir, 'index.js');
    log.step(`widget "${widget.name}"`);
    log.info('bundling', widget.entryTsx, '->', outfile);

    await build({
      entryPoints: [widget.entryTsx],
      outfile,
      bundle: true,
      format: 'esm',
      minify: true,
      jsx: 'automatic',
      platform: 'browser',
      target: 'es2020',
      external: [],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'info',
    });

    await mkdir(outdir, { recursive: true });
    const htmlSrc = path.join(widget.dir, 'index.html');
    const htmlDest = path.join(outdir, 'index.html');
    if (await exists(htmlSrc)) {
      await copyFile(htmlSrc, htmlDest);
      log.info('copied', htmlSrc, '->', htmlDest);
    } else {
      log.warn(`src/widgets/${widget.name}/index.html missing — widget will have no HTML shell`);
    }
  }

  log.info(`bundled ${widgets.length} widget(s)`);
});
