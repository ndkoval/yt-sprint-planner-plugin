/**
 * Generic recording helpers shared by the demo suites: human-like interaction (a visible
 * gliding cursor + realistic timing), branded title cards, and a {@link Captioner} that
 * bakes on-screen captions into the video and writes a matching WebVTT subtitle track.
 *
 * These are UI-agnostic — they drive whatever page is open. The YouTrack demo suite
 * (tests/e2e/demo) imports them for pacing/narration while providing its own
 * YouTrack navigation + frame plumbing. The visible cursor + caption bar themselves
 * are injected by {@link ./cursor.ts} (CURSOR_INIT_SCRIPT).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Locator, type Page } from '@playwright/test';

// ── Human-like interaction ────────────────────────────────────────────────────
// Playwright normally teleports the mouse and types instantly. These helpers move the
// pointer in small steps (so the injected cursor glides), pause briefly, and type with a
// per-key delay — the pacing a person would use in a demo. Tunable via env for A/B.
const STEP = Number(process.env.DEMO_MOVE_STEPS ?? 22);
const AFTER_MOVE_MS = Number(process.env.DEMO_AFTER_MOVE_MS ?? 160);
const AFTER_CLICK_MS = Number(process.env.DEMO_AFTER_CLICK_MS ?? 350);
const TYPE_DELAY_MS = Number(process.env.DEMO_TYPE_DELAY_MS ?? 65);

function resolve(page: Page, target: Locator | string): Locator {
  return typeof target === 'string' ? page.locator(target) : target;
}

/** Glide the cursor to the centre of an element (scrolling it into view first). */
export async function moveTo(page: Page, target: Locator | string): Promise<Locator> {
  const el = resolve(page, target);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: STEP });
    await page.waitForTimeout(AFTER_MOVE_MS);
  }
  return el;
}

/** Move to an element, then click it, with a human pause afterwards. */
export async function humanClick(page: Page, target: Locator | string): Promise<void> {
  const el = await moveTo(page, target);
  await el.click();
  await page.waitForTimeout(AFTER_CLICK_MS);
}

/** Move to a field, focus it, clear it, and type the text at a human cadence. */
export async function humanFill(page: Page, target: Locator | string, text: string): Promise<void> {
  const el = await moveTo(page, target);
  await el.click();
  await el.fill('');
  await el.pressSequentially(text, { delay: TYPE_DELAY_MS });
  await page.waitForTimeout(AFTER_MOVE_MS);
}

/** A short pause between beats so the recording is watchable (not an assertion wait). */
export function settle(page: Page, ms = 650): Promise<void> {
  return page.waitForTimeout(ms);
}

/**
 * Estimated time to speak `text` at the reel's calm narration cadence, plus a tail of
 * breathing room. This paces the video to the narration so the synthesized voice (see
 * scripts/render-reels.mjs, Samantha @ ~175 wpm) never runs into the next line. Kept a
 * touch generous (2.5 wps) so the actual speech always finishes inside its window.
 */
export function estNarrationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 2.5) * 1000) + 600;
}

/**
 * Paint the branded title card on the CURRENT page immediately (persistent, no timer), so the
 * very first recorded frame is the card — not the white about:blank / app-loading screen that
 * would otherwise flash before a navigation's document-start init script paints it. Call this
 * before the first `page.goto` of a reel; the post-navigation card (from the cursor init script
 * with ?reelIntro=1) then takes over seamlessly, and {@link closeTitleCard} fades it out.
 */
export async function primeTitleCard(page: Page, title: string, subtitle: string): Promise<void> {
  const created = await page
    .evaluate(
      ([t, s]) => {
        if (document.getElementById('__demo-titlecard')) return false;
        const el = document.createElement('div');
        el.id = '__demo-titlecard';
        el.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:2147483647', 'display:flex', 'flex-direction:column',
          'align-items:center', 'justify-content:center', 'text-align:center',
          'background:linear-gradient(135deg,#1a73e8,#0b3d91)', 'color:#fff',
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", 'pointer-events:none',
        ].join(';');
        el.innerHTML =
          '<div style="font-size:44px;font-weight:800;letter-spacing:-0.5px;max-width:82%">' +
          (t as string) +
          '</div><div style="font-size:21px;margin-top:14px;opacity:0.92;max-width:72%">' +
          (s as string) +
          '</div>';
        (document.body || document.documentElement).appendChild(el);
        // Cover the scrollbar strip too (a fixed overlay leaves it exposed).
        document.documentElement.style.overflow = 'hidden';
        return true;
      },
      [title, subtitle] as const,
    )
    .catch(() => false);
  // Hold briefly so the recorder's FIRST captured frame is the painted card, not the
  // white pre-paint page (the QA gate samples frame 0 for the title card). Only on
  // first paint — re-priming (e.g. spec + openProjectApp) must not add lead silence.
  if (created === true) await page.waitForTimeout(400);
}

/** Fade out the reel's title card to reveal the app behind it. No-op off a reel. */
export async function closeTitleCard(page: Page): Promise<void> {
  await page.evaluate(
    () => (window as unknown as { __closeTitleCard?: () => Promise<void> }).__closeTitleCard?.(),
  );
  await page.waitForTimeout(200);
}

/**
 * Show a full-screen title card at the very start of a reel so the recording "introduces
 * itself" before the walkthrough begins. Displays for `ms`, then removes itself.
 */
export async function showTitleCard(
  page: Page,
  title: string,
  subtitle: string,
  ms = 2200,
): Promise<void> {
  await page.evaluate(
    ([t, s]) => {
      const el = document.createElement('div');
      el.id = '__demo-titlecard';
      el.style.cssText = [
        'position:fixed','inset:0','z-index:2147483647','display:flex','flex-direction:column',
        'align-items:center','justify-content:center','text-align:center',
        'background:linear-gradient(135deg,#1a73e8,#0b3d91)','color:#fff',
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        'opacity:0','transition:opacity 0.35s ease',
      ].join(';');
      el.innerHTML =
        '<div style="font-size:40px;font-weight:800;letter-spacing:-0.5px;max-width:80%">' +
        (t as string) +
        '</div><div style="font-size:20px;margin-top:14px;opacity:0.9;max-width:70%">' +
        (s as string) +
        '</div>';
      document.body.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = '1'));
    },
    [title, subtitle] as const,
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    const el = document.getElementById('__demo-titlecard');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  });
  await page.waitForTimeout(450);
}

// ── Subtitles ───────────────────────────────────────────────────────────────
interface Cue {
  tMs: number;
  text: string;
}

function vttTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const mmm = Math.floor(ms % 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(mmm, 3)}`;
}

/**
 * Narrates a reel: shows an on-screen caption (baked into the video) and records timed
 * cues so a WebVTT subtitle track can be written for the recording.
 */
export class Captioner {
  private readonly cues: Cue[] = [];
  private readonly startMs = Date.now();
  constructor(private readonly page: Page) {}

  /**
   * Narrate one line: show the caption, record the cue, and hold for the time it takes to
   * speak it. Holding here paces the recording to the narration so, once rendered, the
   * voice for this line finishes before the next `say()` — no overlapping speech.
   */
  async say(text: string): Promise<void> {
    this.cues.push({ tMs: Date.now() - this.startMs, text });
    await this.page.evaluate((t) => {
      (window as unknown as { __demoSay?: (s: string) => void }).__demoSay?.(t);
    }, text);
    if (text) await this.page.waitForTimeout(estNarrationMs(text));
  }

  /** Write a WebVTT subtitle track for the reel and return the file path. */
  async writeVtt(name: string): Promise<string> {
    // Overridable so the YouTrack demo suite writes to its own artifacts dir.
    const dir = process.env.SCP_SUBTITLES_DIR ?? path.join('artifacts', 'demo', 'subtitles');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.vtt`);
    const visible = this.cues.filter((c) => c.text.length > 0);
    const lines = ['WEBVTT', ''];
    visible.forEach((cue, i) => {
      const end = visible[i + 1]?.tMs ?? cue.tMs + 3500;
      lines.push(`${i + 1}`, `${vttTime(cue.tMs)} --> ${vttTime(end)}`, cue.text, '');
    });
    await writeFile(file, lines.join('\n'));
    return file;
  }
}
