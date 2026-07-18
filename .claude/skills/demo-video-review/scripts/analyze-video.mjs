#!/usr/bin/env node
/* global process, console */
/**
 * analyze-video — objective QA for demo/marketing reels.
 *
 * For each .mp4 in a reels directory (optionally paired with a WebVTT track of the
 * same base name in a subtitles dir), it measures the things a human notices when a
 * demo "feels off" and turns them into PASS / WARN / FAIL checks:
 *
 *   - container   : duration, resolution, fps, video+audio codecs
 *   - loudness    : mean/peak volume vs the -16 LUFS / -1.5 dBTP target
 *   - dead air    : leading + trailing silence, total silence %, longest gap
 *   - narration   : per-cue estimated speech length vs the window to the next cue
 *                   → flags OVERLAP (voice talks over the next line) and RUSHED
 *                   (words-per-second too high), plus captions with no breathing gap
 *   - intro       : is the first visible frame the branded title card (not a white
 *                   loading screen)?
 *   - frames      : blank / near-frozen frame sampling
 *
 * It also writes a contact sheet (tiled keyframes) so the frames can be eyeballed.
 *
 * Usage:
 *   node analyze-video.mjs <reelsDir> [subtitlesDir] [--out <report.md>]
 *
 * Pure Node + ffmpeg/ffprobe; no network, no extra deps. Exit code is non-zero if any
 * reel FAILs, so it can gate CI.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── config / thresholds ────────────────────────────────────────────────────────
const TARGET_LUFS = -16; // loudnorm integrated target used by the renderer
const MIN_MEAN_DB = -24; // quieter than this ⇒ too soft
const MAX_MEAN_DB = -12; // louder than this ⇒ too hot
const LEAD_SILENCE_WARN_S = 1.2; // dead air before the first word
const TRAIL_SILENCE_WARN_S = 2.5;
const WPS_RUSHED = 3.3; // words/sec above this reads as "rushed, no pauses"
const CUE_MIN_GAP_S = 0.35; // desired breathing room between spoken lines
const INTRO_WHITE_LUMA = 235; // first frame brighter than this ⇒ likely loading/white, not a title card
const BLANK_LUMA_STD = 6; // luma stddev (over a 16x16 grid) below this ⇒ genuinely flat/blank frame

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const positional = args.filter((a, i) => a !== '--out' && i !== outIdx + (outIdx >= 0 ? 1 : 0) && !a.startsWith('--'));
const reelsDir = positional[0];
const subsDir = positional[1] ?? null;

if (!reelsDir || !existsSync(reelsDir)) {
  console.error(`usage: analyze-video <reelsDir> [subtitlesDir] [--out report.md]`);
  process.exit(2);
}
for (const bin of ['ffprobe', 'ffmpeg']) {
  if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.error(`missing required tool: ${bin}`);
    process.exit(2);
  }
}

// ── ffmpeg/ffprobe helpers ──────────────────────────────────────────────────────
function probe(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration',
     '-of', 'json', file],
    { encoding: 'utf8' },
  );
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { streams: [], format: {} };
  }
}
function volumedetect(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const mean = r.stderr.match(/mean_volume:\s*([-0-9.]+) dB/);
  const max = r.stderr.match(/max_volume:\s*([-0-9.]+) dB/);
  return { mean: mean ? Number(mean[1]) : null, max: max ? Number(max[1]) : null };
}
function silences(file, thresholdDb = -40, minDur = 0.4) {
  const r = spawnSync('ffmpeg',
    ['-hide_banner', '-i', file, '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDur}`, '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = [];
  const re = /silence_start:\s*([0-9.]+)|silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;
  let m, cur = null;
  while ((m = re.exec(r.stderr))) {
    if (m[1] !== undefined) cur = { start: Number(m[1]) };
    else if (cur) { cur.end = Number(m[2]); cur.dur = Number(m[3]); out.push(cur); cur = null; }
  }
  return out;
}
/** Average RGB + per-channel stddev of one downscaled frame (via 2x2 rawvideo). */
function frameStats(file, t) {
  const r = spawnSync('ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
     '-vf', 'scale=2:2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer' });
  const b = r.stdout;
  if (!b || b.length < 12) return null;
  const px = [];
  for (let i = 0; i + 2 < b.length; i += 3) px.push([b[i], b[i + 1], b[i + 2]]);
  const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / px.length);
  const std = [0, 1, 2].map((c) => Math.sqrt(px.reduce((s, p) => s + (p[c] - mean[c]) ** 2, 0) / px.length));
  const luma = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
  return { mean, std, luma };
}
/**
 * Luma stddev over a grid×grid downscale — a robust "is this frame flat/blank?" measure.
 * A real app screen (tables, text, a dimmed modal) has structure and scores well above the
 * threshold; a solid white/black transition frame scores near 0. Coarse 2x2 sampling can't
 * tell these apart, so blank detection uses this instead.
 */
function frameLumaStd(file, t, grid = 16) {
  const r = spawnSync('ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
     '-vf', `scale=${grid}:${grid},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer' });
  const b = r.stdout;
  if (!b || b.length < grid * grid) return null;
  const a = [...b.subarray(0, grid * grid)];
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}
function contactSheet(file, dur, out, n = 6) {
  const times = Array.from({ length: n }, (_, i) => (dur * (i + 0.5)) / n);
  const tmp = mkdtempSync(path.join(tmpdir(), 'cs-'));
  const tiles = [];
  times.forEach((t, i) => {
    const p = path.join(tmp, `f${i}.png`);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
      '-frames:v', '1', '-vf', 'scale=480:-1', p]);
    if (existsSync(p)) tiles.push(p);
  });
  if (tiles.length) {
    const inputs = tiles.flatMap((t) => ['-i', t]);
    const filter = `${tiles.map((_, i) => `[${i}:v]`).join('')}tile=layout=${Math.ceil(tiles.length / 2)}x2[o]`;
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[o]', '-y', out]);
  }
  rmSync(tmp, { recursive: true, force: true });
  return existsSync(out) ? out : null;
}

// ── VTT parsing + narration model ───────────────────────────────────────────────
function parseVtt(text) {
  const cues = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d)\.(\d\d\d)/);
    if (!m) continue;
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const body = block.split(/\r?\n/).slice(1).filter((l) => !l.includes('-->')).join(' ').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}
// Rough speech length: ~2.7 words/sec at a calm demo cadence + a short lead-in.
function estSpeechSec(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / 2.7 + 0.25;
}

// ── per-reel analysis ────────────────────────────────────────────────────────────
function fmt(n, d = 1) { return n === null || n === undefined ? 'n/a' : Number(n).toFixed(d); }

function analyze(file, vttFile) {
  const checks = [];
  const add = (level, name, detail) => checks.push({ level, name, detail });

  const info = probe(file);
  const v = info.streams.find((s) => s.codec_type === 'video') ?? {};
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const dur = Number(info.format?.duration) || 0;
  const [fn, fd] = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = fd ? fn / fd : 0;

  add(v.width && v.height ? 'PASS' : 'FAIL', 'container',
    `${v.codec_name ?? '?'} ${v.width}x${v.height} @ ${fmt(fps)}fps, ${fmt(dur)}s, audio=${a ? a.codec_name : 'NONE'}`);
  if (!a) add('FAIL', 'audio-present', 'no audio stream');

  // Loudness
  if (a) {
    const { mean, max } = volumedetect(file);
    let lvl = 'PASS';
    if (mean === null) lvl = 'WARN';
    else if (mean < MIN_MEAN_DB || mean > MAX_MEAN_DB) lvl = 'WARN';
    add(lvl, 'loudness', `mean ${fmt(mean)} dB, peak ${fmt(max)} dB (target ~${TARGET_LUFS} LUFS, want mean ${MIN_MEAN_DB}..${MAX_MEAN_DB} dB)`);

    // Dead air
    const sil = silences(file);
    const lead = sil.find((s) => s.start <= 0.05);
    const leadS = lead ? lead.end : 0;
    add(leadS > LEAD_SILENCE_WARN_S ? 'WARN' : 'PASS', 'lead-silence',
      `${fmt(leadS)}s of silence before the first word (want < ${LEAD_SILENCE_WARN_S}s)`);
    const trail = sil.find((s) => Math.abs((s.end ?? dur) - dur) < 0.25);
    const trailS = trail ? (trail.end ?? dur) - trail.start : 0;
    add(trailS > TRAIL_SILENCE_WARN_S ? 'WARN' : 'PASS', 'trail-silence', `${fmt(trailS)}s of silence at the end`);
    const totalSil = sil.reduce((s, x) => s + (x.dur ?? 0), 0);
    add('INFO', 'silence-map', `${sil.length} gaps, ${fmt((totalSil / dur) * 100, 0)}% of the reel is silent`);
  }

  // Narration model from VTT (overlap + pacing) — the "phrases run into each other" check.
  if (vttFile && existsSync(vttFile)) {
    const cues = parseVtt(readFileSync(vttFile, 'utf8'));
    let overlaps = 0, rushed = 0, tightGaps = 0;
    const details = [];
    cues.forEach((c, i) => {
      const next = cues[i + 1];
      const need = estSpeechSec(c.text);
      const words = c.text.split(/\s+/).filter(Boolean).length;
      const wps = words / need;
      if (next) {
        const window = next.start - c.start;
        const slack = window - need;
        if (slack < 0) { overlaps += 1; details.push(`  · cue ${i + 1} needs ~${fmt(need)}s but next starts in ${fmt(window)}s → OVERLAP by ${fmt(-slack)}s: "${c.text.slice(0, 48)}…"`); }
        else if (slack < CUE_MIN_GAP_S) { tightGaps += 1; }
      }
      if (wps > WPS_RUSHED) rushed += 1;
    });
    add(overlaps ? 'FAIL' : 'PASS', 'narration-overlap',
      overlaps ? `${overlaps} line(s) overrun the next caption (voices talk over each other)` : `no overlapping narration across ${cues.length} cues`);
    if (details.length) details.forEach((d) => add('INFO', '', d.trim()));
    add(tightGaps ? 'WARN' : 'PASS', 'narration-gaps',
      tightGaps ? `${tightGaps} line(s) have < ${CUE_MIN_GAP_S}s of pause before the next` : 'comfortable pauses between lines');
    add(rushed ? 'WARN' : 'PASS', 'narration-pace',
      rushed ? `${rushed} line(s) exceed ${WPS_RUSHED} words/sec (rushed)` : 'calm speaking pace');
  } else {
    add('WARN', 'narration-model', 'no matching .vtt found — cannot check overlap/pacing');
  }

  // Intro: is the very first frame the branded title card (not a white loading screen)?
  const f0 = frameStats(file, 0.1) ?? frameStats(file, 0.0);
  if (f0) {
    const white = f0.luma > INTRO_WHITE_LUMA;
    const blueish = f0.mean[2] > f0.mean[0] + 12; // title card is a blue gradient
    add(white ? 'FAIL' : 'PASS', 'intro-title-card',
      white
        ? `first frame is bright/white (luma ${fmt(f0.luma, 0)}) — looks like a loading/app screen, not a title card`
        : `first frame looks like a title card (luma ${fmt(f0.luma, 0)}, ${blueish ? 'blue gradient' : 'non-white'})`);
  }

  // Frozen / blank sampling (16x16 luma variance, so real screens aren't false-flagged).
  let blanks = 0;
  const samples = 8;
  for (let i = 0; i < samples; i += 1) {
    const sd = frameLumaStd(file, (dur * (i + 0.5)) / samples);
    if (sd !== null && sd < BLANK_LUMA_STD) blanks += 1;
  }
  add(blanks > 0 ? 'WARN' : 'PASS', 'blank-frames',
    blanks > 0 ? `${blanks}/${samples} sampled frames are near-blank` : `no blank frames in ${samples} samples`);

  const sheet = contactSheet(file, dur, file.replace(/\.mp4$/, '.contact.png'));
  return { checks, sheet: sheet ? path.basename(sheet) : null };
}

// ── run ──────────────────────────────────────────────────────────────────────────
const reels = readdirSync(reelsDir).filter((f) => f.endsWith('.mp4')).sort();
const lines = ['# Demo video review', '', `Analyzed ${reels.length} reel(s) in \`${reelsDir}\`.`, ''];
const rank = { FAIL: 0, WARN: 0, PASS: 0, INFO: 0 };
let worst = 'PASS';

for (const name of reels) {
  const file = path.join(reelsDir, name);
  const base = name.replace(/\.mp4$/, '');
  const vtt = subsDir ? path.join(subsDir, `${base}.vtt`) : null;
  const { checks, sheet } = analyze(file, vtt);
  lines.push(`## ${name}`, '');
  for (const c of checks) {
    if (c.level in rank) rank[c.level] += 1;
    if (c.level === 'FAIL') worst = 'FAIL';
    else if (c.level === 'WARN' && worst !== 'FAIL') worst = 'WARN';
    const badge = c.level === 'PASS' ? '✅' : c.level === 'WARN' ? '⚠️' : c.level === 'FAIL' ? '❌' : '  ';
    lines.push(c.name ? `- ${badge} **${c.name}** — ${c.detail}` : `  ${c.detail}`);
  }
  if (sheet) lines.push('', `Contact sheet: \`${sheet}\``);
  lines.push('');
}

lines.unshift(
  `**Verdict: ${worst === 'PASS' ? '✅ APPROVE' : worst === 'WARN' ? '⚠️ NEEDS POLISH' : '❌ FIX REQUIRED'}** ` +
  `(${rank.FAIL} fail, ${rank.WARN} warn, ${rank.PASS} pass)`, '',
);

const report = lines.join('\n');
if (outPath) { writeFileSync(outPath, report); console.log(`wrote ${outPath}`); }
else console.log(report);
process.exit(worst === 'FAIL' ? 1 : 0);
