/**
 * publish-demo-assets — take the recorded reels from artifacts/ and publish them as the
 * README's demo media (tracked under docs/media/), so the project page's demo video is always
 * sourced from the latest recording automatically.
 *
 * Produces:
 *   docs/media/demo.mp4            all reels concatenated (install → walkthrough → multi-project)
 *   docs/media/demo-poster.png     a poster frame (the planning board) for the README thumbnail
 *   docs/media/install.mp4         reel #1 on its own
 *   docs/media/walkthrough.mp4     reel #2 on its own
 *   docs/media/multi-project.mp4   reel #3 on its own
 *
 * Requires ffmpeg. Run after `npm run demo:record:docker` (or `npm run demo`). Degrades with a
 * clear message if the reels or ffmpeg are missing.
 */
import { mkdir, access, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR, REPO_ROOT } from './lib/paths.mjs';

const REELS_DIR = path.join(ARTIFACTS_DIR, 'demo', 'reels');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'media');

// Recorded reel -> published file name, in demo.mp4 concat order.
const REELS = [
  { src: '01-setup.mp4', out: 'install.mp4' },
  { src: '02-walkthrough.mp4', out: 'walkthrough.mp4' },
  { src: '03-multi-project.mp4', out: 'multi-project.mp4' },
];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
function have(bin) {
  return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
}

runMain('publish-demo-assets', async (log) => {
  if (!have('ffmpeg')) {
    log.warn('ffmpeg not found — cannot publish demo media.');
    return;
  }
  const present = [];
  for (const reel of REELS) {
    if (await exists(path.join(REELS_DIR, reel.src))) present.push(reel);
  }
  if (present.length === 0) {
    log.warn(`no reels in ${REELS_DIR} — run "npm run demo:record:docker" first.`);
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });

  // Trim ~0.3s off the START (both streams together, so audio stays in sync) to drop the brief
  // white about:blank frame the recorder captures before the title card paints. The reels have
  // ~1s of lead silence, so this stays well under the 1.2s lead-silence budget.
  const LEAD_TRIM = '0.3';
  const trimLead = (src, dest) => {
    const r = spawnSync(
      'ffmpeg',
      [
        '-y', '-ss', LEAD_TRIM, '-i', src,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
        dest,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      log.warn(`trim failed for ${path.basename(dest)}: ${r.stderr?.slice(-200) ?? ''}`);
      return false;
    }
    return true;
  };

  const published = [];
  for (const reel of present) {
    const src = path.join(REELS_DIR, reel.src);
    const dest = path.join(OUT_DIR, reel.out);
    if (!trimLead(src, dest)) await copyFile(src, dest);
    published.push(dest);
    log.info('wrote', dest);
  }

  // Combined demo: all reels in order — re-encoded from the trimmed copies so the concat
  // is robust and the first frame is the (clean) title card.
  const demo = path.join(OUT_DIR, 'demo.mp4');
  if (published.length > 1) {
    const inputs = published.flatMap((p) => ['-i', p]);
    const scaled = published.map((_p, i) => `[${i}:v]scale=1280:720,setsar=1[v${i}];`).join('');
    const pairs = published.map((_p, i) => `[v${i}][${i}:a]`).join('');
    const r = spawnSync(
      'ffmpeg',
      [
        '-y', ...inputs,
        '-filter_complex', `${scaled}${pairs}concat=n=${published.length}:v=1:a=1[v][a]`,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
        demo,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) log.warn(`concat failed: ${r.stderr?.slice(-300) ?? ''}`);
    else log.info('wrote', demo);
  } else {
    await copyFile(published[0], demo);
    log.info('wrote', demo, '(single reel)');
  }

  // Poster: a frame from the walkthrough that shows the planning board (~20s in).
  const posterSrc = path.join(OUT_DIR, (present.find((r) => r.out === 'walkthrough.mp4') ?? present[0]).out);
  const poster = path.join(OUT_DIR, 'demo-poster.png');
  const p = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '20', '-i', posterSrc, '-frames:v', '1', '-vf', 'scale=1280:720', poster],
    { encoding: 'utf8' },
  );
  if (p.status !== 0) log.warn(`poster failed: ${p.stderr?.slice(-200) ?? ''}`);
  else log.info('wrote', poster);

  log.info('demo media published to docs/media/');
});
