/**
 * cleanup:youtrack — tear down everything the harness created.
 *
 * Deletes the seeded project / board / groups via REST, STOPS the local YouTrack
 * process, and removes the temp data dir. ALWAYS safe to run: it tolerates partial
 * state (missing manifest, already-deleted entities, dead pid) and never throws on a
 * best-effort delete. Writes artifacts/orphan-cleanup-report.json.
 *
 * Still honours the safety gates: only proceeds against a local/disposable host, and
 * the REST deletions require YT_TEST_ALLOW_DESTRUCTIVE=true (process/dir teardown is
 * always allowed since it only touches temp dirs this harness created).
 */
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';
import { assertNotProduction, readEnv, YtRest } from './lib/yt-env.mjs';

const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'test-environment-manifest.json');
const REPORT_PATH = path.join(ARTIFACTS_DIR, 'orphan-cleanup-report.json');

async function readManifest() {
  try {
    await access(MANIFEST_PATH, constants.F_OK);
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function tryDelete(rest, log, label, path_, results) {
  if (!path_) return;
  try {
    await rest.del(path_);
    log.info('deleted', label);
    results.push({ target: label, status: 'deleted' });
  } catch (err) {
    log.warn(`could not delete ${label}: ${err}`);
    results.push({ target: label, status: 'skipped', reason: String(err) });
  }
}

function stopProcess(log, pid, results) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
    log.info('sent SIGTERM to YouTrack pid', pid);
    results.push({ target: `pid:${pid}`, status: 'stopped' });
  } catch (err) {
    // ESRCH => already gone; treat as success.
    log.warn(`process ${pid} not stopped (may already be down): ${err}`);
    results.push({ target: `pid:${pid}`, status: 'skipped', reason: String(err) });
  }
}

async function removeDir(log, dir, results) {
  if (!dir) return;
  try {
    await rm(dir, { recursive: true, force: true });
    log.info('removed temp dir', dir);
    results.push({ target: dir, status: 'removed' });
  } catch (err) {
    log.warn(`could not remove ${dir}: ${err}`);
    results.push({ target: dir, status: 'skipped', reason: String(err) });
  }
}

runMain('cleanup:youtrack', async (log) => {
  const env = readEnv();
  const manifest = await readManifest();
  const seeded = manifest.seeded ?? {};
  const results = [];

  const baseUrl = env.baseUrl || manifest.baseUrl;
  // REST deletion only when we have a target + token + destructive flag + local host.
  if (baseUrl && env.adminToken && env.allowDestructive) {
    try {
      assertNotProduction(baseUrl, log);
      const rest = new YtRest(baseUrl, env.adminToken, log);
      log.step('delete seeded REST entities');
      await tryDelete(
        rest,
        log,
        `board:${seeded.boardId}`,
        seeded.boardId ? `/api/agiles/${encodeURIComponent(seeded.boardId)}` : null,
        results,
      );
      await tryDelete(
        rest,
        log,
        `project:${seeded.projectId}`,
        seeded.projectId ? `/api/admin/projects/${encodeURIComponent(seeded.projectId)}` : null,
        results,
      );
      for (const [name, id] of Object.entries(seeded.groups ?? {})) {
        await tryDelete(
          rest,
          log,
          `group:${name}:${id}`,
          id ? `/api/admin/groups/${encodeURIComponent(id)}` : null,
          results,
        );
      }
      // Custom fields are global/shared; we detach by deleting the project only. Confirmed on
      // 2025.3 that a deleted project's period field prototypes linger globally (instances:[]).
      // We intentionally DON'T delete them here: the demo/seed field names ("Original Effort",
      // "Current Effort") are reused across runs (ensurePeriodField finds them by name), so
      // deleting a shared prototype would break a concurrent demo. Re-seeding reuses them.
    } catch (err) {
      log.warn(`REST cleanup skipped: ${err}`);
      results.push({ target: 'rest', status: 'skipped', reason: String(err) });
    }
  } else {
    log.warn(
      'REST cleanup skipped (need YT_TEST_BASE_URL + YT_TEST_ADMIN_TOKEN + ' +
        'YT_TEST_ALLOW_DESTRUCTIVE=true). Local process/dir teardown still runs.',
    );
    results.push({ target: 'rest', status: 'skipped', reason: 'preconditions not met' });
  }

  log.step('stop local YouTrack instance + remove temp dir');
  // Preferred: stop the daemon via its launcher (the standalone build daemonizes).
  if (manifest.ytHome) {
    try {
      const jar = spawnSync('sh', ['-c', `ls "${manifest.ytHome}"/launcher/lib/*-launcher.jar`], {
        encoding: 'utf8',
      }).stdout.trim();
      const java = manifest.jdk ? path.join(manifest.jdk, 'bin', 'java') : 'java';
      spawnSync(java, ['-jar', jar, 'stop'], { cwd: manifest.ytHome, encoding: 'utf8' });
      spawnSync(java, ['-jar', jar, 'kill'], { cwd: manifest.ytHome, encoding: 'utf8' });
      log.info('stopped YouTrack via launcher');
      results.push({ target: `youtrack:${manifest.ytHome}`, status: 'stopped' });
    } catch (err) {
      log.warn(`launcher stop failed: ${err}`);
      results.push({ target: 'youtrack-launcher', status: 'skipped', reason: String(err) });
    }
  }
  // Legacy/back-compat: also SIGTERM a raw pid if the manifest carries one.
  stopProcess(log, manifest.pid, results);
  await removeDir(log, manifest.workDir, results);

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const report = {
    ranAt: new Date().toISOString(),
    runId: manifest.runId ?? null,
    hadManifest: Object.keys(manifest).length > 0,
    actions: results,
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  log.info('wrote cleanup report', REPORT_PATH);
});
