/**
 * render-reels — add a voiceover to the marketing reels.
 *
 * For each reel that has a WebVTT subtitle track (written by the demo suite), synthesize
 * timed speech from the cues (macOS `say`), align each cue to its start time, and mux the
 * result onto the reel's recorded video as an H.264 .mp4 under artifacts/demo/reels/.
 * The on-screen captions are already baked into the video, so the .mp4 has synchronized
 * captions + narration.
 *
 * Degrades gracefully: if `say` (TTS) or ffmpeg/ffprobe are unavailable (e.g. Linux CI),
 * it logs and skips without failing the build.
 */
import { mkdir, readFile, readdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';

const DEMO_DIR = path.join(ARTIFACTS_DIR, 'demo');
const RESULTS_DIR = path.join(DEMO_DIR, 'test-results');
const SUBTITLES_DIR = path.join(DEMO_DIR, 'subtitles');
const OUT_DIR = path.join(DEMO_DIR, 'reels');

// vtt name (without extension) -> substring of the Playwright test-results dir for the video.
const REELS = [
  { vtt: '01-product-walkthrough', dir: '00-product-walkthrough', title: 'Product walkthrough' },
  { vtt: '02-team-capacity', dir: '00b-team-capacity', title: 'Team capacity' },
  { vtt: '03-team-configuration', dir: '00c-team-configuration', title: 'Team configuration' },
  { vtt: '04-installation', dir: '00d-installation', title: 'Installation' },
];

function have(bin, arg = '-version') {
  return spawnSync(bin, [arg], { stdio: 'ignore' }).status === 0;
}
async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Parse WebVTT into { startMs, text } cues. */
function parseVtt(text) {
  const cues = [];
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const m = block.match(/(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s*-->/);
    if (!m) continue;
    const startMs =
      Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4]);
    const lines = block.split(/\r?\n/);
    const textLine = lines.slice(lines.findIndex((l) => l.includes('-->')) + 1).join(' ').trim();
    if (textLine) cues.push({ startMs, text: textLine });
  }
  return cues;
}

/** Find the newest video.webm under a test-results subdir matching `dirSub`. */
async function findVideo(dirSub) {
  if (!(await exists(RESULTS_DIR))) return null;
  for (const entry of await readdir(RESULTS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.includes(dirSub)) {
      const v = path.join(RESULTS_DIR, entry.name, 'video.webm');
      if (await exists(v)) return v;
    }
  }
  return null;
}

function ffprobeDurationSec(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file],
    { encoding: 'utf8' },
  );
  return Number(r.stdout.trim()) || 0;
}

runMain('render-reels', async (log) => {
  const hasSay = have('say', '-v?') || process.platform === 'darwin';
  const hasFfmpeg = have('ffmpeg');
  const hasFfprobe = have('ffprobe');
  if (!hasSay || !hasFfmpeg || !hasFfprobe) {
    log.warn(
      `voiceover skipped (say=${hasSay} ffmpeg=${hasFfmpeg} ffprobe=${hasFfprobe}). ` +
        'The webm reels + WebVTT subtitles are still produced.',
    );
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const work = path.join(tmpdir(), 'scp-reels');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  let rendered = 0;
  for (const reel of REELS) {
    const vttPath = path.join(SUBTITLES_DIR, `${reel.vtt}.vtt`);
    const video = await findVideo(reel.dir);
    if (!(await exists(vttPath)) || video === null) {
      log.warn(`skip ${reel.vtt} (missing vtt or video)`);
      continue;
    }
    log.step(`voiceover: ${reel.title}`);
    const cues = parseVtt(await readFile(vttPath, 'utf8'));
    if (cues.length === 0) {
      log.warn(`no cues in ${reel.vtt}`);
      continue;
    }

    // 1) Synthesize each cue to an aiff.
    const inputs = [];
    for (let i = 0; i < cues.length; i += 1) {
      const aiff = path.join(work, `${reel.vtt}-${i}.aiff`);
      const say = spawnSync('say', ['-o', aiff, '--', cues[i].text], { encoding: 'utf8' });
      if (say.status !== 0 || !(await exists(aiff))) {
        log.warn(`say failed for cue ${i}: ${say.stderr ?? ''}`);
        continue;
      }
      inputs.push({ file: aiff, startMs: cues[i].startMs });
    }
    if (inputs.length === 0) continue;

    // 2) Overlay each cue at its start time onto one audio track.
    const voice = path.join(work, `${reel.vtt}-voice.wav`);
    const args = [];
    inputs.forEach((inp) => args.push('-i', inp.file));
    const filter = inputs
      .map((inp, i) => `[${i}]adelay=${inp.startMs}|${inp.startMs}[a${i}]`)
      .join(';');
    const mix = `${inputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${inputs.length}:normalize=0[out]`;
    const mixRes = spawnSync(
      'ffmpeg',
      ['-y', ...args, '-filter_complex', `${filter};${mix}`, '-map', '[out]', voice],
      { encoding: 'utf8' },
    );
    if (mixRes.status !== 0) {
      log.warn(`audio mix failed for ${reel.vtt}: ${mixRes.stderr?.slice(-300) ?? ''}`);
      continue;
    }

    // 3) Mux the voiceover onto the video (re-encode to H.264/AAC .mp4).
    const out = path.join(OUT_DIR, `${reel.vtt}.mp4`);
    const dur = ffprobeDurationSec(video);
    const mux = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i', video,
        '-i', voice,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-t', String(dur > 0 ? dur : 60),
        out,
      ],
      { encoding: 'utf8' },
    );
    if (mux.status !== 0) {
      log.warn(`mux failed for ${reel.vtt}: ${mux.stderr?.slice(-300) ?? ''}`);
      continue;
    }
    log.info('wrote', out);
    rendered += 1;
  }

  await rm(work, { recursive: true, force: true });
  log.info(`rendered ${rendered}/${REELS.length} voiced reel(s) -> ${OUT_DIR}`);
});
