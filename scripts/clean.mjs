/**
 * clean — remove build/test output: dist/, artifacts/, and any *.zip at repo root.
 *
 * Safe to run repeatedly. Never touches src/ or config.
 */
import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, DIST_DIR, ARTIFACTS_DIR } from './lib/paths.mjs';

runMain('clean', async (log) => {
  for (const dir of [DIST_DIR, ARTIFACTS_DIR]) {
    log.info('removing', dir);
    await rm(dir, { recursive: true, force: true });
  }

  const entries = await readdir(REPO_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.zip')) {
      const p = path.join(REPO_ROOT, entry.name);
      log.info('removing', p);
      await rm(p, { force: true });
    }
  }
});
