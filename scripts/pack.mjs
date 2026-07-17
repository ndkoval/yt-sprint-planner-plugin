/**
 * pack — zip the built dist/ tree into dist/sprint-capacity-planner.zip.
 *
 * Uses a pure-Node ZIP writer (no external deps) so it works identically on macOS
 * and CI. Output path is exactly dist/sprint-capacity-planner.zip.
 *
 * Requires that `build` has run first (dist/manifest.json must exist).
 */
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { DIST_DIR, ZIP_PATH } from './lib/paths.mjs';
import { createZip } from './lib/zip.mjs';

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect files under dir, returning { name (archive-relative), abs }. */
async function collect(dir, base = dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collect(abs, base)));
    } else if (entry.isFile()) {
      const rel = path.relative(base, abs).split(path.sep).join('/');
      // Never include a previous archive in the new one.
      if (rel === 'sprint-capacity-planner.zip') continue;
      out.push({ name: rel, abs });
    }
  }
  return out;
}

runMain('pack', async (log) => {
  if (!(await exists(path.join(DIST_DIR, 'manifest.json')))) {
    throw new Error('dist/manifest.json not found — run `npm run build` before pack');
  }

  const files = await collect(DIST_DIR);
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) {
    throw new Error('dist/ is empty — nothing to pack');
  }
  log.info(`packing ${files.length} file(s)`);
  for (const f of files) log.info('  +', f.name);

  const entries = [];
  for (const f of files) {
    entries.push({ name: f.name, data: await readFile(f.abs) });
  }

  const zipBuf = createZip(entries);
  await writeFile(ZIP_PATH, zipBuf);
  log.info(`wrote ${ZIP_PATH} (${zipBuf.length} bytes)`);
});
