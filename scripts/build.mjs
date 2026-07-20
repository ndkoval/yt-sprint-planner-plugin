/**
 * build — full app package build into dist/.
 *
 * Pipeline: clean -> build-backend -> build-widgets -> copy static package files.
 *
 * Package contents (the app ZIP, see pack.mjs) mirror the YouTrack App layout:
 *   dist/manifest.json
 *   dist/entity-extensions.json
 *   dist/settings.json
 *   dist/backend.js
 *   dist/widgets/<name>/index.{js,html}
 *   dist/*.js                  (workflow rule modules — at the PACKAGE ROOT)
 *   dist/assets/*              (icons referenced by manifest, if present)
 *
 * Workflow file placement: the manifest declares no explicit workflows path, so YouTrack
 * auto-discovers workflow rule modules as TOP-LEVEL package scripts. They must sit at the
 * package root (alongside backend.js), NOT in a dist/workflows/ subfolder (modules in a
 * subfolder are never registered as rules on 2025.3). They stay co-located at the root, so the
 * relative `require('./workflow-common.js')` between them still resolves; no name collision
 * with backend.js (workflow-*.js).
 */
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, DIST_DIR, fromRoot } from './lib/paths.mjs';

// Workflow rule modules go at the package ROOT so YouTrack discovers them as top-level scripts.
const WORKFLOWS_DEST = DIST_DIR;

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
  log.info(`copied ${n} workflow module(s) -> dist/ (package root)`);
}

async function copyAssets(log) {
  const assetsSrc = fromRoot('assets');
  if (!(await exists(assetsSrc))) {
    // The manifest references assets/icon.svg + assets/icon-dark.svg (copied below). Verified
    // on 2025.3: the installed app resolves the icon. If the dir is absent the app just ships
    // without an icon — not fatal for the build.
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
