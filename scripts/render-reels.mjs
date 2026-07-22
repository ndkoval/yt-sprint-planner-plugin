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
import { mkdir, readFile, readdir, rm, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';

// The reels are recorded against a YouTrack instance (tests/e2e/demo). The base
// artifacts dir is overridable (REELS_BASE); the reel list is overridable via REELS_JSON.
const DEMO_DIR = path.join(ARTIFACTS_DIR, process.env.REELS_BASE ?? 'demo');
const RESULTS_DIR = path.join(DEMO_DIR, 'test-results');
const SUBTITLES_DIR = path.join(DEMO_DIR, 'subtitles');
const OUT_DIR = path.join(DEMO_DIR, 'reels');

// Narration voice: a natural, pleasant macOS voice at a calm rate (words/min). Samantha
// is present on every current macOS; the rate is tuned to match helpers.ts estNarrationMs
// (~2.5 words/sec) so the video pacing and the spoken audio agree. Override with
// SCP_SAY_VOICE / SCP_SAY_RATE if a nicer voice is installed (e.g. a Premium/Enhanced one).
const VOICE_ARGS = [
  '-v', process.env.SCP_SAY_VOICE ?? 'Samantha',
  '-r', process.env.SCP_SAY_RATE ?? '175',
];

// Preferred voice: Piper (a local, offline NEURAL TTS) — far more natural and engaging than
// macOS `say`. If the Piper binary + a voice model are present we use it; otherwise we fall
// back to `say`. Install: python -m venv ~/.piper-venv && ~/.piper-venv/bin/pip install
// piper-tts, then download a voice (e.g. en_US-amy-medium) into ~/.local/share/piper-voices.
// The amy voice's default pace (~2.5 words/sec) matches helpers.ts estNarrationMs, so the
// caption timing and the spoken audio stay aligned. Override with SCP_PIPER_BIN/SCP_PIPER_MODEL.
const PIPER_BIN =
  process.env.SCP_PIPER_BIN ?? path.join(homedir(), '.piper-venv', 'bin', 'piper');
const PIPER_MODEL =
  process.env.SCP_PIPER_MODEL ??
  path.join(homedir(), '.local', 'share', 'piper-voices', 'en_US-amy-medium.onnx');

// Real-YouTrack reels (recorded against a live instance). vtt name (without extension) ->
// substring of the Playwright test-results dir for the video.
const DEFAULT_REELS = [
  { vtt: '01-setup', dir: '01-setup', title: 'Install & configure' },
  { vtt: '02-walkthrough', dir: '02-walkthrough', title: 'App walkthrough' },
  { vtt: '03-multi-project', dir: '03-multi-project', title: 'Multiple projects' },
];
const REELS = process.env.REELS_JSON ? JSON.parse(process.env.REELS_JSON) : DEFAULT_REELS;

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

/**
 * Produce a SILENT .mp4 per reel (transcode of the recorded webm) into OUT_DIR. Used when no TTS
 * voice is available (e.g. a Linux CI runner without Piper/`say`) so downstream steps
 * (analyze-video, publish-demo-assets) still have an .mp4 set to work with — the reels just have
 * no narration. The shipping reels are always rendered with a voice locally. Returns the count.
 */
async function renderSilentReels(log) {
  await mkdir(OUT_DIR, { recursive: true });
  let n = 0;
  for (const reel of REELS) {
    const video = await findVideo(reel.dir);
    if (video === null) {
      log.warn(`skip ${reel.vtt} (no recorded video)`);
      continue;
    }
    const out = path.join(OUT_DIR, `${reel.vtt}.mp4`);
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-i', video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out],
      { encoding: 'utf8' },
    );
    if (r.status === 0) {
      n += 1;
      log.info(`wrote ${path.basename(out)} (silent)`);
    } else {
      log.warn(`transcode failed for ${reel.vtt}: ${r.stderr?.slice(-200) ?? ''}`);
    }
  }
  log.info(`produced ${n} silent reel(s) in ${OUT_DIR}`);
  return n;
}

runMain('render-reels', async (log) => {
  const usePiper = (await exists(PIPER_BIN)) && (await exists(PIPER_MODEL));
  const hasSay = have('say', '-v?') || process.platform === 'darwin';
  const hasVoice = usePiper || hasSay;
  const hasFfmpeg = have('ffmpeg');
  const hasFfprobe = have('ffprobe');
  if (!hasFfmpeg || !hasFfprobe) {
    log.warn(`cannot render reels: ffmpeg=${hasFfmpeg} ffprobe=${hasFfprobe} (both required).`);
    return;
  }
  if (!hasVoice) {
    log.warn(
      `no voiceover available (piper=${usePiper} say=${hasSay}) — producing SILENT reels ` +
        '(the shipping reels are rendered with a voice locally).',
    );
    await renderSilentReels(log);
    return;
  }
  log.info(
    usePiper
      ? `voice: Piper (neural) — ${path.basename(PIPER_MODEL)}`
      : `voice: macOS say — ${VOICE_ARGS[1]}`,
  );

  // Synthesize one cue to an audio file (wav for Piper, aiff for say); returns true on success.
  const synthCue = (text, out) => {
    if (usePiper) {
      return (
        spawnSync(PIPER_BIN, ['-m', PIPER_MODEL, '-f', out], { input: text, encoding: 'utf8' })
          .status === 0
      );
    }
    return spawnSync('say', [...VOICE_ARGS, '-o', out, '--', text], { encoding: 'utf8' }).status === 0;
  };

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

    // 1) Synthesize each cue to a clip with a calm, natural voice (a fixed voice so runs are
    //    reproducible and the cadence matches helpers.ts estNarrationMs, ~2.5 words/sec).
    const ext = usePiper ? 'wav' : 'aiff';
    const inputs = [];
    for (let i = 0; i < cues.length; i += 1) {
      const clip = path.join(work, `${reel.vtt}-${i}.${ext}`);
      if (!synthCue(cues[i].text, clip) || !(await exists(clip))) {
        log.warn(`voice synth failed for cue ${i}`);
        continue;
      }
      inputs.push({ file: clip, startMs: cues[i].startMs, durMs: ffprobeDurationSec(clip) * 1000 });
    }
    if (inputs.length === 0) continue;

    // 2) Place each clip at its caption's start time, but never before the previous clip
    //    has finished (+ a small gap) — a backstop so two lines can never talk over each
    //    other even if a caption beat was authored slightly tight. Authoring paces the
    //    video to the speech (Captioner.say holds for estNarrationMs), so in practice each
    //    clip lands at its caption time; this only nudges the rare overrun later.
    const GAP_MS = 150;
    let cursor = 0;
    for (const inp of inputs) {
      inp.atMs = Math.round(Math.max(inp.startMs, cursor));
      cursor = inp.atMs + inp.durMs + GAP_MS;
    }
    const voice = path.join(work, `${reel.vtt}-voice.wav`);
    const args = [];
    inputs.forEach((inp) => args.push('-i', inp.file));
    const filter = inputs
      .map((inp, i) => `[${i}]adelay=${inp.atMs}|${inp.atMs}[a${i}]`)
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

    // 3) Mux the voiceover onto the video (re-encode to H.264/AAC .mp4). Trim the
    //    tail to at most a few seconds after the LAST word — the recorder keeps
    //    rolling through test teardown (screenshots, subtitle writes), and a long
    //    silent static outro reads as a stalled video.
    const TAIL_HOLD_S = 2.5;
    const FADE_S = 0.7;
    const out = path.join(OUT_DIR, `${reel.vtt}.mp4`);
    const fullDur = ffprobeDurationSec(video);
    const lastVoiceEndS = Math.max(...inputs.map((inp) => (inp.atMs + inp.durMs) / 1000));
    const dur = Math.min(fullDur > 0 ? fullDur : 60, lastVoiceEndS + TAIL_HOLD_S);
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
        // Fade the picture out at the very end (a hard cut on a static frame read
        // as dead air in review) …
        '-vf', `fade=t=out:st=${Math.max(0, dur - FADE_S).toFixed(2)}:d=${FADE_S}`,
        // … normalise the narration and PAD the audio to the video's length so the
        // stream doesn't end 4s early (players show it as a stalled track).
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad',
        '-c:a', 'aac',
        '-b:a', '160k',
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

  // Voice tools were present but synthesis/mux produced nothing (e.g. a broken voice model) —
  // fall back to silent reels so downstream still has a usable .mp4 set.
  if (rendered === 0) {
    log.warn('voiced rendering produced no reels — falling back to SILENT reels.');
    await renderSilentReels(log);
  }

  // A tiny index so the VOICED reels are easy to find and play (the Playwright report's
  // .webm videos are silent — Playwright can't record audio; the narration is here).
  const cards = REELS.map(
    (r) =>
      `<section><h2>${r.title}</h2><video controls preload="metadata" src="${r.vtt}.mp4"></video></section>`,
  ).join('\n');
  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Sprint Capacity Planner — demo reels (with voiceover)</title>
<style>body{font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:28px;background:#0b1020;color:#e8eaf0}
h1{margin:0 0 4px} p.sub{color:#9aa3b2;margin:0 0 24px}
section{margin:0 0 28px} h2{font-size:16px;margin:0 0 8px}
video{width:100%;max-width:960px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.4);background:#000}</style></head>
<body><h1>Demo reels — with voiceover</h1>
<p class="sub">These .mp4 files have narration + captions. Note: the Playwright report videos (.webm) are silent — Playwright cannot record audio.</p>
${cards}
</body></html>`;
  await writeFile(path.join(OUT_DIR, 'index.html'), indexHtml);

  log.info(`rendered ${rendered}/${REELS.length} voiced reel(s) -> ${OUT_DIR} (open index.html)`);
});
