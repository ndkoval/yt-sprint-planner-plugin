/**
 * publish:test-summary — assemble artifacts/index.html linking every artifact (§30).
 *
 * Links (when present): the app ZIP, unit/coverage reports, the Playwright HTML
 * report + JSON, contact sheets, videos, ui-analysis.md, video-integrity.json, the
 * test-environment manifest and cleanup report. A single browsable entry point for CI.
 *
 * Never fails on missing artifacts — it simply omits links that do not exist and
 * marks them as "not produced".
 */
import { mkdir, writeFile, access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR, DIST_DIR } from './lib/paths.mjs';

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function listDir(dir, filter) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && (!filter || filter(e.name)))
    .map((e) => path.join(dir, e.name));
}

async function collectVideos() {
  const out = [];
  async function walk(dir) {
    if (!(await exists(dir))) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (/\.(webm|mp4)$/i.test(e.name)) out.push(abs);
    }
  }
  await walk(path.join(ARTIFACTS_DIR, 'test-results'));
  await walk(path.join(ARTIFACTS_DIR, 'videos'));
  return out;
}

/** Build a linked-list section; `items` are absolute paths, linked relative to artifacts/. */
function section(title, items, note) {
  const parts = [`<section><h2>${esc(title)}</h2>`];
  if (items.length === 0) {
    parts.push(`<p class="muted">not produced${note ? ` — ${esc(note)}` : ''}</p>`);
  } else {
    parts.push('<ul>');
    for (const item of items) {
      parts.push(`<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`);
    }
    parts.push('</ul>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

function rel(abs) {
  return path.relative(ARTIFACTS_DIR, abs).split(path.sep).join('/');
}

runMain('publish:test-summary', async (log) => {
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  const sections = [];

  // App ZIP (lives in dist/, linked relatively from artifacts/).
  const zipAbs = path.join(DIST_DIR, 'sprint-capacity-planner.zip');
  const zipItems = (await exists(zipAbs))
    ? [{ href: path.relative(ARTIFACTS_DIR, zipAbs).split(path.sep).join('/'), label: 'sprint-capacity-planner.zip' }]
    : [];
  sections.push(section('App Package', zipItems, 'run `npm run build && npm run pack`'));

  // Reports.
  const reportItems = [];
  for (const [label, p] of [
    ['Playwright HTML report', path.join(ARTIFACTS_DIR, 'playwright-report', 'index.html')],
    ['Playwright JSON report', path.join(ARTIFACTS_DIR, 'playwright-report', 'report.json')],
    ['Coverage report', path.join(ARTIFACTS_DIR, 'coverage', 'index.html')],
    ['UI analysis (markdown)', path.join(ARTIFACTS_DIR, 'ui-analysis.md')],
    ['Test environment manifest', path.join(ARTIFACTS_DIR, 'test-environment-manifest.json')],
    ['Orphan cleanup report', path.join(ARTIFACTS_DIR, 'orphan-cleanup-report.json')],
  ]) {
    if (await exists(p)) reportItems.push({ href: rel(p), label });
  }
  sections.push(section('Reports', reportItems));

  // Contact sheets.
  const sheets = await listDir(path.join(ARTIFACTS_DIR, 'contact-sheets'), (n) => n.endsWith('.png'));
  sections.push(
    section(
      'Contact Sheets',
      sheets.map((p) => ({ href: rel(p), label: path.basename(p) })),
      'produced by `npm run test:e2e:analyze`',
    ),
  );

  // Videos.
  const videos = await collectVideos();
  sections.push(
    section(
      'Videos',
      videos.map((p) => ({ href: rel(p), label: rel(p) })),
      'produced by the Playwright run',
    ),
  );

  // Inline the video-integrity summary if present.
  let integrityNote = '';
  const integrityPath = path.join(ARTIFACTS_DIR, '..', 'tests', 'video-analysis', 'video-integrity.json');
  if (await exists(integrityPath)) {
    try {
      const j = JSON.parse(await readFile(integrityPath, 'utf8'));
      integrityNote = `<p>Video integrity: ${j.videoCount} video(s), ${j.failures} failure(s).</p>`;
    } catch {
      /* ignore */
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sprint Capacity Planner — Test Artifacts</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color: #1f2328; }
  h1 { border-bottom: 2px solid #d0d7de; padding-bottom: .4rem; }
  section { margin: 1.5rem 0; }
  h2 { font-size: 1.1rem; }
  .muted { color: #6e7781; font-style: italic; }
  ul { line-height: 1.7; }
  footer { margin-top: 3rem; color: #6e7781; font-size: .85rem; }
</style>
</head>
<body>
<h1>Sprint Capacity Planner — Test Artifacts</h1>
<p>Generated ${esc(new Date().toISOString())}.</p>
${integrityNote}
${sections.join('\n')}
<footer>Assembled by scripts/publish-test-summary.mjs</footer>
</body>
</html>
`;

  const outPath = path.join(ARTIFACTS_DIR, 'index.html');
  await writeFile(outPath, html);
  log.info('wrote', outPath);
});
