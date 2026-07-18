---
name: demo-video-review
description: Analyze demo/marketing reels (.mp4 + WebVTT) for the defects humans notice — overlapping/rushed narration, a nasty or too-fast voice, dead air, a title card that doesn't come first, wrong resolution/loudness, blank/frozen frames — and produce a PASS/WARN/FAIL report + contact sheet. Use whenever generating or changing the demo reels, or when someone says a video "feels off". Also documents how to author reels that pass.
---

# Demo video review

Objective QA for the marketing reels this repo produces (`artifacts/demo/reels/*.mp4`,
narrated from `artifacts/demo/subtitles/*.vtt`). It turns "the video feels off" into
concrete, measurable checks, and records the authoring rules that make a reel good.

## When to use

- After `npm run demo:reels` or `npm run test:all` regenerates the reels.
- When a reel is reported as having bad sound, a late/absent intro, wrong pacing, etc.
- Before committing any change to the reel specs (`tests/e2e/demo/*.spec.ts`), the
  demo helpers (`tests/e2e/demo/helpers.ts`), or the renderer (`scripts/render-reels.mjs`).

## Analyze

```bash
node .claude/skills/demo-video-review/scripts/analyze-video.mjs \
  artifacts/demo/reels artifacts/demo/subtitles \
  --out artifacts/demo/reels/video-review.md
```

Exit code is non-zero if any reel FAILs, so it can gate CI. It writes the markdown
report and one `*.contact.png` contact sheet per reel (tiled keyframes) so frames can
be eyeballed. Read the report, then open the contact sheets (and, for anything
flagged, extract the specific frame with `ffmpeg -ss <t> -i reel.mp4 -frames:v 1 out.png`
and actually look at it).

### What it checks

| Check | Fails when | Why it matters |
| --- | --- | --- |
| `container` | no video stream | wrong file / broken render |
| `intro-title-card` | first frame is bright/white | the reel opens on a loading/app screen instead of the branded card |
| `narration-overlap` | a spoken line's estimated length overruns the next caption | voices talk over each other — the #1 "bad sound" cause |
| `narration-pace` | > 3.3 words/sec on a line | rushed, no pauses |
| `narration-gaps` | < 0.35s pause before the next line | no breathing room |
| `lead-silence` | > 1.2s of silence before the first word | dead air at the start |
| `loudness` | mean outside −24..−12 dB | too quiet / too hot |
| `blank-frames` | sampled frame is near-flat | frozen or blank section |

The narration checks read the `.vtt`, so they model overlap/pace even before you
listen. `estSpeechSec` assumes ~2.7 words/sec — keep it in sync with the renderer's
voice rate.

## Authoring rules (how to make reels that pass)

These are baked into `helpers.ts` and `render-reels.mjs`; keep them true when editing.

1. **Title card first.** The very first frames must be the branded card, not the app
   loading spinner. Reels navigate with `waitUntil: 'commit'` and immediately mount the
   title card (`mountTitleCard`) so it covers the load; the app renders behind it, then
   the card fades (`closeCard()`). Never call `openTab` (which waits for `networkidle`
   and shows the spinner) before the card in a reel.
2. **Narrate over the card.** Say the first line while the title card is up so audio
   starts within ~0.5s — no dead air.
3. **One voice, calm, no overlap.** The renderer synthesizes with a fixed pleasant voice
   at a calm rate and places each clip **sequentially** (`max(cueStart, prevEnd + gap)`),
   so lines never overlap even if a caption beat was too tight. Prefer short lines and
   enough `settle()` between `cap.say()` calls that the caption timing already matches the
   speech — the analyzer's `narration-gaps`/`narration-pace` checks enforce this.
4. **Keep lines short.** One idea per caption, ≤ ~12 words. Long sentences read rushed
   and force overlap.
5. **720p, cursor visible, deterministic.** 1280×720, the injected cursor glides to each
   target, and the world is reset per test so runs are reproducible.
6. **Loudness normalized.** The renderer applies `loudnorm=I=-16:TP=-1.5:LRA=11`; don't
   remove it.

## Tools

Requires `ffmpeg` + `ffprobe` (Homebrew) and, for rendering narration, macOS `say`.
The analyzer is pure Node + ffmpeg; no network, no extra deps.
