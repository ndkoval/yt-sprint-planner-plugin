/**
 * build — full app package build into dist/.
 *
 * Pipeline: clean -> build-backend -> build-widgets -> copy static package files.
 *
 * Package contents (the app ZIP, see pack.mjs) mirror the YouTrack App layout:
 *   dist/manifest.json
 *   dist/entity-extensions.json
 *   dist/settings.json
 *   dist/backend/index.js
 *   dist/widgets/<name>/index.{js,html}
 *   dist/workflows/*.js        (see SPIKE below)
 *   dist/assets/*              (icons referenced by manifest, if present)
 *
 * SPIKE: workflow file placement. The manifest does not declare an explicit
 * workflows path, and the Apps SDK auto-discovers workflow rule modules bundled in
 * the app package. We keep them together under dist/workflows/ so the relative
 * `require('./workflow-common.js')` between modules keeps working. If a real
 * instance expects them at the package root instead, change WORKFLOWS_DEST only.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, DIST_DIR, fromRoot } from './lib/paths.mjs';

const WORKFLOWS_DEST = path.join(DIST_DIR, 'workflows');

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runScript(log, script) {
  log.step(`run ${script}`);
  const res = spawnSync(process.execPath, [fromRoot('scripts', script)], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });
  if (res.status !== 0) {
    throw new Error(`${script} exited with code ${res.status}`);
  }
}

async function copyStaticFile(log, name) {
  const src = fromRoot(name);
  const dest = path.join(DIST_DIR, name);
  if (!(await exists(src))) {
    throw new Error(`required package file missing: ${src}`);
  }
  await copyFile(src, dest);
  log.info('copied', name);
}

async function copyWorkflows(log) {
  const workflowsSrc = fromRoot('src', 'workflows');
  if (!(await exists(workflowsSrc))) {
    log.warn('src/workflows missing — no workflow modules copied');
    return;
  }
  await mkdir(WORKFLOWS_DEST, { recursive: true });
  const entries = await readdir(workflowsSrc, { withFileTypes: true });
  let n = 0;
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      await copyFile(path.join(workflowsSrc, entry.name), path.join(WORKFLOWS_DEST, entry.name));
      n += 1;
    }
  }
  log.info(`copied ${n} workflow module(s) -> dist/workflows/`);
}

async function copyAssets(log) {
  const assetsSrc = fromRoot('assets');
  if (!(await exists(assetsSrc))) {
    // SPIKE: manifest references assets/icon.svg + assets/icon-dark.svg. If the
    // assets dir is not authored yet the app will have no icon; not fatal for build.
    log.warn('assets/ missing — manifest icon(s) will be absent from the package');
    return;
  }
  const dest = path.join(DIST_DIR, 'assets');
  await mkdir(dest, { recursive: true });
  const entries = await readdir(assetsSrc, { withFileTypes: true });
  let n = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      await copyFile(path.join(assetsSrc, entry.name), path.join(dest, entry.name));
      n += 1;
    }
  }
  log.info(`copied ${n} asset file(s) -> dist/assets/`);
}

runMain('build', async (log) => {
  runScript(log, 'clean.mjs');
  await mkdir(DIST_DIR, { recursive: true });

  runScript(log, 'build-backend.mjs');
  runScript(log, 'build-widgets.mjs');

  log.step('copy static package files');
  await copyStaticFile(log, 'manifest.json');
  await copyStaticFile(log, 'entity-extensions.json');
  await copyStaticFile(log, 'settings.json');
  await copyWorkflows(log);
  await copyAssets(log);

  log.info('build complete -> dist/');
});
