/**
 * Shared helpers for the demo E2E suite: persona navigation, human-like interaction
 * (visible gliding cursor + realistic timing), accessibility scan, and a console/page
 * error guard so every journey also asserts the UI is clean.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CURSOR_INIT_SCRIPT } from './cursor.js';

export type Persona = 'manager' | 'alice' | 'bob' | 'charlie';

const PROJECT = 'proj-demo';
export const DEMO_PROJECT = PROJECT;

/**
 * Shared `test` for the demo suite. Auto-fixtures (run for every test, across all files):
 *  - reset the harness world to the exact seeded baseline (`/__demo/reset`) → deterministic
 *    and independent of run order;
 *  - inject a visible cursor overlay into every page + popup so the recordings look like a
 *    real person is using the app.
 * Import `test`/`expect` from here.
 */
export const test = base.extend<{ freshWorld: void; demoCursor: void }>({
  freshWorld: [
    async ({ request }, use) => {
      await request.post('/__demo/reset');
      await use();
    },
    { auto: true },
  ],
  demoCursor: [
    async ({ context }, use) => {
      await context.addInitScript(CURSOR_INIT_SCRIPT);
      await use();
    },
    { auto: true },
  ],
});
export { expect };

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

/** Reel intro: a branded title card painted before the first frame (see cursor.ts). */
export interface ReelIntro {
  title: string;
  subtitle: string;
}

/**
 * A text-less brand-gradient cover used to mask in-reel page navigations (persona
 * switches): it hides the app's loading spinner behind the brand gradient, so a switch
 * reads as a smooth branded wipe instead of a white flash. Pair with {@link closeTitleCard}
 * right after the navigation to fade it away.
 */
export const REEL_WIPE: ReelIntro = { title: '', subtitle: '' };

function withReel(params: URLSearchParams, reel?: ReelIntro): void {
  if (!reel) return;
  params.set('reelIntro', '1');
  params.set('reelTitle', reel.title);
  params.set('reelSubtitle', reel.subtitle);
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
    // Overridable so the real-YouTrack demo suite writes to its own artifacts dir.
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

/**
 * Open the project-tab widget as a persona and wait for the first data render. Pass
 * `reel` to paint a branded title card as the very first frame (the app loads behind it;
 * fade it with {@link closeTitleCard} after narrating the intro).
 */
export async function openTab(
  page: Page,
  persona: Persona,
  sprintId?: string,
  reel?: ReelIntro,
): Promise<void> {
  const params = new URLSearchParams({ as: persona, projectId: PROJECT });
  if (sprintId) params.set('sprint', sprintId);
  withReel(params, reel);
  await page.goto(`/project-tab/index.html?${params.toString()}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Sprint capacity', { exact: false }).first()).toBeVisible();
}

/** Open the project-settings widget as a persona (optionally with a reel title card). */
export async function openSettings(page: Page, persona: Persona, reel?: ReelIntro): Promise<void> {
  const params = new URLSearchParams({ as: persona, projectId: PROJECT });
  withReel(params, reel);
  await page.goto(`/project-settings/index.html?${params.toString()}`, { waitUntil: 'networkidle' });
}

/** Attach a console/page-error collector; call the returned assert at the end. */
export function guardErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => {
    const real = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
    expect(real, `unexpected console/page errors:\n${real.join('\n')}`).toHaveLength(0);
  };
}

/** Run an axe accessibility scan and fail on serious/critical violations. */
export async function assertAccessible(page: Page, info: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // color-contrast is intentionally not enforced in the standalone harness: the widget
    // inherits YouTrack's theme tokens (--ring-* variables) in production, which the
    // bare demo page does not provide, so contrast here is not representative. All
    // structural checks (labels, roles, names, keyboard) remain enforced.
    .disableRules(['color-contrast'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    blocking,
    `blocking a11y violations: ${blocking.map((v) => v.id).join(', ')}`,
  ).toHaveLength(0);
}
