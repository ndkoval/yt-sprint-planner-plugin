/**
 * test:e2e:analyze — analyse Playwright UI artifacts (§28.3 / §29).
 *
 * - Reads the Playwright JSON report (artifacts/playwright-report/report.json).
 * - Finds recorded videos (artifacts/test-results/**, artifacts/videos/**).
 * - Uses ffprobe to extract per-video metadata and ffmpeg to assess integrity:
 *     exists, decodes, duration >= MIN, resolution present, not-all-black/white.
 * - Generates tiled contact sheets into artifacts/contact-sheets/.
 * - Writes tests/video-analysis/video-integrity.json and artifacts/ui-analysis.md.
 *
 * Degrades gracefully: if ffprobe/ffmpeg or the report are missing it logs clearly
 * and still writes what it can. It exits non-zero ONLY on real integrity failures
 * (a video that exists but does not decode / is too short / is entirely black|white).
 *
 * SPIKE: the exact §29 ui-analysis.md template is defined in the project spec (not
 * present in this repo). The layout below covers Summary + per-journey + video
 * integrity + accessibility; adjust headings to match the canonical template.
 */
import { mkdir, writeFile, readFile, readdir, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR, fromRoot } from './lib/paths.mjs';

const MIN_DURATION_SEC = Number(process.env.YT_TEST_MIN_VIDEO_SEC ?? 0.5);
const BLACK_THRESHOLD = 16; // YAVG below this (0-255) => effectively black
const WHITE_THRESHOLD = 239; // YAVG above this => effectively white
// ANALYZE_BASE lets the analyzer target a specific run's artifacts (e.g. artifacts/demo);
// defaults to the top-level artifacts dir (the real-YouTrack E2E run).
const BASE_DIR = process.env.ANALYZE_BASE
  ? path.resolve(process.env.ANALYZE_BASE)
  : ARTIFACTS_DIR;
const REPORT_CANDIDATES = [
  path.join(BASE_DIR, 'report.json'),
  path.join(BASE_DIR, 'playwright-report', 'report.json'),
];
const CONTACT_SHEET_DIR = path.join(BASE_DIR, 'contact-sheets');
const INTEGRITY_PATH = process.env.ANALYZE_BASE
  ? path.join(BASE_DIR, 'video-integrity.json')
  : fromRoot('tests', 'video-analysis', 'video-integrity.json');
const UI_ANALYSIS_PATH = path.join(BASE_DIR, 'ui-analysis.md');

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function have(bin) {
  const res = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  return res.status === 0;
}

async function findVideos() {
  // Scan the raw test outputs only; the HTML report keeps hashed copies of the same
  // videos under playwright-report/data which would double-count.
  const roots = [path.join(BASE_DIR, 'test-results'), path.join(BASE_DIR, 'videos')];
  const found = [];
  async function walk(dir) {
    if (!(await exists(dir))) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (/\.(webm|mp4)$/i.test(entry.name)) found.push(abs);
    }
  }
  for (const r of roots) await walk(r);
  return found;
}

function ffprobeMeta(file) {
  const res = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name:format=duration',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    const s = (parsed.streams && parsed.streams[0]) || {};
    return {
      width: s.width ?? null,
      height: s.height ?? null,
      codec: s.codec_name ?? null,
      duration: parsed.format && parsed.format.duration ? Number(parsed.format.duration) : null,
    };
  } catch {
    return null;
  }
}

/** Average luminance across a few sampled frames via ffmpeg signalstats. */
function averageLuma(file) {
  const res = spawnSync(
    'ffmpeg',
    [
      '-i', file,
      '-vf', "select='not(mod(n,15))',signalstats,metadata=print",
      '-an', '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const vals = [];
  for (const m of out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
    vals.push(Number(m[1]));
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function makeContactSheet(file, outPng) {
  const res = spawnSync(
    'ffmpeg',
    [
      '-y', '-i', file,
      '-vf', 'fps=1,scale=320:-1,tile=4x4',
      '-frames:v', '1',
      outPng,
    ],
    { stdio: 'ignore' },
  );
  return res.status === 0;
}

async function analyseVideos(log, hasFfprobe, hasFfmpeg) {
  const videos = await findVideos();
  log.info(`found ${videos.length} video file(s)`);
  const results = [];
  let failures = 0;

  if (videos.length > 0) await mkdir(CONTACT_SHEET_DIR, { recursive: true });

  for (const file of videos) {
    const rel = path.relative(ARTIFACTS_DIR, file);
    const entry = {
      file: rel,
      exists: true,
      decodes: false,
      durationSec: null,
      width: null,
      height: null,
      codec: null,
      avgLuma: null,
      allBlack: null,
      allWhite: null,
      contactSheet: null,
      checks: {},
      ok: true,
      problems: [],
    };
    const size = (await stat(file)).size;
    if (size === 0) {
      entry.ok = false;
      entry.problems.push('empty file (0 bytes)');
    }

    if (hasFfprobe) {
      const meta = ffprobeMeta(file);
      if (meta) {
        entry.decodes = true;
        entry.durationSec = meta.duration;
        entry.width = meta.width;
        entry.height = meta.height;
        entry.codec = meta.codec;
      } else {
        entry.problems.push('ffprobe could not decode the stream');
        entry.ok = false;
      }
    } else {
      entry.problems.push('ffprobe unavailable — decode/metadata not verified');
    }

    if (hasFfmpeg && entry.decodes) {
      const luma = averageLuma(file);
      entry.avgLuma = luma;
      if (luma !== null) {
        entry.allBlack = luma < BLACK_THRESHOLD;
        entry.allWhite = luma > WHITE_THRESHOLD;
        if (entry.allBlack) {
          entry.problems.push(`video is effectively all-black (YAVG ${luma.toFixed(1)})`);
          entry.ok = false;
        }
        if (entry.allWhite) {
          entry.problems.push(`video is effectively all-white (YAVG ${luma.toFixed(1)})`);
          entry.ok = false;
        }
      }
      const sheetName = `${rel.replace(/[\\/]/g, '__')}.png`;
      const sheetPath = path.join(CONTACT_SHEET_DIR, sheetName);
      if (makeContactSheet(file, sheetPath)) {
        entry.contactSheet = path.relative(ARTIFACTS_DIR, sheetPath);
      }
    }

    // Integrity checks — only fail on real problems.
    entry.checks.exists = entry.exists;
    entry.checks.decodes = hasFfprobe ? entry.decodes : 'skipped';
    entry.checks.minDuration =
      entry.durationSec === null ? 'skipped' : entry.durationSec >= MIN_DURATION_SEC;
    entry.checks.hasResolution =
      entry.width === null ? 'skipped' : Boolean(entry.width && entry.height);
    entry.checks.notAllBlack = entry.allBlack === null ? 'skipped' : !entry.allBlack;
    entry.checks.notAllWhite = entry.allWhite === null ? 'skipped' : !entry.allWhite;

    if (entry.checks.minDuration === false) {
      entry.problems.push(`duration ${entry.durationSec}s < min ${MIN_DURATION_SEC}s`);
      entry.ok = false;
    }
    if (entry.checks.hasResolution === false) {
      entry.problems.push('missing resolution');
      entry.ok = false;
    }

    if (!entry.ok) failures += 1;
    results.push(entry);
    log.info(`  ${entry.ok ? 'OK  ' : 'FAIL'} ${rel}${entry.problems.length ? ' :: ' + entry.problems.join('; ') : ''}`);
  }

  return { results, failures };
}

async function readReport(log) {
  let reportPath = null;
  for (const candidate of REPORT_CANDIDATES) {
    if (await exists(candidate)) {
      reportPath = candidate;
      break;
    }
  }
  if (reportPath === null) {
    log.warn(
      `Playwright JSON report not found (tried ${REPORT_CANDIDATES.join(', ')}) — Summary will be empty`,
    );
    return null;
  }
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (err) {
    log.warn(`could not parse Playwright report: ${err}`);
    return null;
  }
}

/** Flatten Playwright JSON report suites into { title, status } rows. */
function summariseReport(report) {
  const rows = [];
  const stats = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  function visitSuite(suite, trail) {
    const title = [...trail, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results[results.length - 1];
        const status = test.status ?? (last ? last.status : 'unknown');
        rows.push({ title: [...title, spec.title].join(' › '), status });
        stats.total += 1;
        if (status === 'expected' || status === 'passed') stats.passed += 1;
        else if (status === 'skipped') stats.skipped += 1;
        else if (status === 'flaky') stats.flaky += 1;
        else stats.failed += 1;
      }
    }
    for (const child of suite.suites ?? []) visitSuite(child, title);
  }
  for (const suite of report.suites ?? []) visitSuite(suite, []);
  return { rows, stats };
}

function renderMarkdown({ reportSummary, video, hasFfprobe, hasFfmpeg }) {
  const lines = [];
  lines.push('# UI Analysis');
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()} by scripts/analyze-ui-artifacts.mjs_`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  if (reportSummary) {
    const s = reportSummary.stats;
    lines.push(`- Total tests: ${s.total}`);
    lines.push(`- Passed: ${s.passed}`);
    lines.push(`- Failed: ${s.failed}`);
    lines.push(`- Flaky: ${s.flaky}`);
    lines.push(`- Skipped: ${s.skipped}`);
  } else {
    lines.push('- No Playwright JSON report found (suite may not have run, or ran with all specs skipped).');
  }
  lines.push('');
  lines.push('## Journeys');
  lines.push('');
  if (reportSummary && reportSummary.rows.length) {
    lines.push('| Test | Status |');
    lines.push('| --- | --- |');
    for (const r of reportSummary.rows) lines.push(`| ${r.title} | ${r.status} |`);
  } else {
    lines.push('_No test results available._');
  }
  lines.push('');
  lines.push('## Video Integrity');
  lines.push('');
  if (!hasFfprobe || !hasFfmpeg) {
    lines.push(
      `> Tooling: ffprobe ${hasFfprobe ? 'available' : 'MISSING'}, ffmpeg ${hasFfmpeg ? 'available' : 'MISSING'}. ` +
        'Missing tools mean some checks were skipped (not failed).',
    );
    lines.push('');
  }
  if (video.results.length) {
    lines.push('| Video | Decodes | Duration (s) | Resolution | Avg Luma | Result | Contact Sheet |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const v of video.results) {
      const res = v.width && v.height ? `${v.width}x${v.height}` : '-';
      lines.push(
        `| ${v.file} | ${v.decodes} | ${v.durationSec ?? '-'} | ${res} | ${
          v.avgLuma === null ? '-' : v.avgLuma.toFixed(1)
        } | ${v.ok ? 'OK' : 'FAIL: ' + v.problems.join('; ')} | ${
          v.contactSheet ? `[sheet](${v.contactSheet})` : '-'
        } |`,
      );
    }
  } else {
    lines.push('_No videos found._');
  }
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  const testFailures = reportSummary ? reportSummary.stats.failed : 0;
  const videoFailures = video.failures;
  const noReport = !reportSummary;
  if (testFailures === 0 && videoFailures === 0 && !noReport) {
    lines.push('**APPROVE** — all journeys passed and every recorded video passed integrity checks.');
  } else {
    const reasons = [];
    if (noReport) reasons.push('no Playwright report was found');
    if (testFailures > 0) reasons.push(`${testFailures} test(s) failed`);
    if (videoFailures > 0) reasons.push(`${videoFailures} video integrity failure(s)`);
    lines.push(`**FIX REQUIRED** — ${reasons.join('; ')}.`);
  }
  lines.push('');
  lines.push('## Accessibility');
  lines.push('');
  lines.push(
    '_Accessibility (axe) assertions run inside the Playwright specs (see tests/e2e/fixtures/axe.ts); ' +
      'blocking violations fail the owning test and appear in the Journeys table above._',
  );
  lines.push('');
  return lines.join('\n');
}

runMain('test:e2e:analyze', async (log) => {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(path.dirname(INTEGRITY_PATH), { recursive: true });

  const hasFfprobe = have('ffprobe');
  const hasFfmpeg = have('ffmpeg');
  if (!hasFfprobe) log.warn('ffprobe not found — video decode/metadata checks skipped');
  if (!hasFfmpeg) log.warn('ffmpeg not found — black/white + contact sheets skipped');

  const report = await readReport(log);
  const reportSummary = report ? summariseReport(report) : null;

  log.step('analyse videos');
  const video = await analyseVideos(log, hasFfprobe, hasFfmpeg);

  const integrity = {
    generatedAt: new Date().toISOString(),
    tooling: { ffprobe: hasFfprobe, ffmpeg: hasFfmpeg },
    minDurationSec: MIN_DURATION_SEC,
    videoCount: video.results.length,
    failures: video.failures,
    videos: video.results,
  };
  await writeFile(INTEGRITY_PATH, JSON.stringify(integrity, null, 2));
  log.info('wrote', INTEGRITY_PATH);

  const md = renderMarkdown({ reportSummary, video, hasFfprobe, hasFfmpeg });
  await writeFile(UI_ANALYSIS_PATH, md);
  log.info('wrote', UI_ANALYSIS_PATH);

  if (video.failures > 0) {
    log.error(`${video.failures} video integrity failure(s)`);
    process.exitCode = 1;
  }
});
