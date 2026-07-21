/**
 * Helpers for the REAL-YouTrack demo suite. The app runs as installed widgets inside a
 * YouTrack project (in a nested iframe) plus the native Kanban board. These helpers
 * open the app widget and return its {@link Frame} so journeys can drive the real app UI,
 * while the cursor + caption overlays live in the top YouTrack page.
 *
 * The generic recording helpers (Captioner, cursor motion, title cards) live in
 * tests/e2e/shared; only the navigation/frame plumbing here is YouTrack-specific.
 */
import { spawnSync } from 'node:child_process';
import { test as base, expect, type Page, type Frame, type Locator } from '@playwright/test';
import { CURSOR_INIT_SCRIPT } from '../shared/cursor.js';
import { primeTitleCard } from '../shared/recording.js';

export {
  Captioner,
  showTitleCard,
  primeTitleCard,
  closeTitleCard,
  settle,
  moveTo,
  humanClick,
  humanFill,
  estNarrationMs,
} from '../shared/recording.js';
export { expect };

/** Real-demo test: injects the cursor + caption overlay into every YouTrack page. */
export const test = base.extend<{ demoCursor: void }>({
  demoCursor: [
    async ({ context }, use) => {
      await context.addInitScript(CURSOR_INIT_SCRIPT);
      await use();
    },
    { auto: true },
  ],
});

export const PROJECT_KEY = process.env.PROJECT_KEY ?? 'AGP';
export const BOARD_NAME = 'AppGlass Board';
/** The second demo project (per-project independence scenes). */
export const SECOND_PROJECT_KEY = process.env.SECOND_PROJECT_KEY ?? 'ORB';

/** Find the app widget's iframe (a nested srcdoc frame) by its content. */
export async function appFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  // The widget content lives in a nested about:srcdoc frame. Identify it by an actual
  // element query (textContent falsely matches the YouTrack app-host shell frame).
  const marker = /Raw capacity|Focus factor|Not configured yet|Loading Sprint capacity|Agile board|Effort field mapping/;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      const n = await f.getByText(marker).count().catch(() => 0);
      if (n > 0) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('app widget frame not found');
}

export interface OpenAppOptions {
  /** Paint a branded title card as the first frame (via the cursor init reelIntro params). */
  reel?: { title: string; subtitle: string };
  /** Narrate this line over the title card while YouTrack + the widget load (kills dead air). */
  cap?: { say(text: string): Promise<void> };
  intro?: string;
  /** Target project key (defaults to the flagship demo project). */
  projectKey?: string;
}

/**
 * Open a project app widget ("Sprint Capacity" or "Sprint Capacity Settings") and return its
 * frame. With `reel`, a branded title card is painted before the first frame and stays up
 * through the load; narrate `intro` over it (then fade with {@link closeTitleCard}).
 */
export async function openProjectApp(
  page: Page,
  widget = 'Sprint Capacity',
  opts: OpenAppOptions = {},
): Promise<Frame> {
  const params = new URLSearchParams({ tab: 'apps' });
  if (opts.reel) {
    params.set('reelIntro', '1');
    params.set('reelTitle', opts.reel.title);
    params.set('reelSubtitle', opts.reel.subtitle);
  }
  const url = `/projects/${opts.projectKey ?? PROJECT_KEY}?${params.toString()}`;
  // Paint the title card on the current (about:blank) page first so the reel's VERY FIRST frame
  // is the branded card, not a white flash before the navigation's document-start card paints.
  if (opts.reel) await primeTitleCard(page, opts.reel.title, opts.reel.subtitle);
  if (opts.cap && opts.intro) {
    // Start navigating (the card paints at document-start) and narrate over the load without
    // waiting for the whole YouTrack SPA — keeps the intro card's dead-air short.
    const nav = page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(500);
    await opts.cap.say(opts.intro);
    await nav;
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(1500);
  await page.getByText(new RegExp(`^${widget}$`)).first().click();
  return appFrame(page);
}

/** Open the native YouTrack agile board (optionally a specific sprint). */
export async function openBoard(page: Page, agileId: string, sprintId?: string): Promise<void> {
  const url = sprintId ? `/agiles/${agileId}/${sprintId}` : `/agiles/${agileId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
}

/** Resolve an agile board id by name (via the authenticated REST API) and open it. */
export async function openBoardByName(page: Page, name = BOARD_NAME): Promise<string> {
  const res = await page.request.get('/api/agiles?fields=id,name&$top=200', {
    headers: { Accept: 'application/json' },
  });
  const boards = (await res.json()) as Array<{ id: string; name: string }>;
  const id = Array.isArray(boards) ? boards.find((b) => b.name === name)?.id ?? '' : '';
  if (!id) throw new Error(`board not found: ${name}`);
  await page.goto(`/agiles/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6500);
  return id;
}

/**
 * Perform a VISIBLE, reliable drag of a board card onto a lane.
 *
 * The board uses native HTML5 drag-and-drop, which does not fire from synthetic mouse events,
 * so we dispatch the real drag events (dragstart/drag/dragover/drop/dragend) with a shared
 * DataTransfer created in the widget frame — reliable regardless of the tall auto-height
 * iframe's scroll position. For visibility we glide the injected cursor AND dispatch `drag`
 * events carrying the frame-relative cursor position, so the board's floating ghost follows it.
 */
export async function dragCard(
  page: Page,
  frame: Frame,
  source: Locator,
  target: Locator,
): Promise<void> {
  // The board uses HTML5 drag-and-drop, which does NOT fire from synthetic mouse events, so we
  // dispatch the real drag events with a shared DataTransfer created in the widget frame — this
  // is reliable regardless of the tall auto-height iframe's scroll position (dispatchEvent
  // targets the element directly). For VISIBILITY we (a) glide the top-level injected cursor and
  // (b) dispatch `drag` events with the widget-frame-relative cursor position so the board's
  // floating ghost tracks the cursor on the recording.
  const rect = (loc: Locator) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(24, r.height / 2) };
    });

  await source.scrollIntoViewIfNeeded();
  const fromTop = await source.boundingBox(); // top-page coords, for the visible cursor
  const fromIn = await rect(source); // frame-relative, for the ghost
  if (fromTop !== null) {
    await page.mouse.move(fromTop.x + fromTop.width / 2, fromTop.y + fromTop.height / 2, { steps: 12 });
    await page.waitForTimeout(160);
  }

  const dt = await frame.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: dt });
  await page.waitForTimeout(140);

  await target.scrollIntoViewIfNeeded();
  const toTop = await target.boundingBox();
  const toIn = await rect(target);
  const steps = 22;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (fromTop !== null && toTop !== null) {
      const cx = fromTop.x + fromTop.width / 2 + (toTop.x + toTop.width / 2 - (fromTop.x + fromTop.width / 2)) * t;
      const cy = fromTop.y + fromTop.height / 2 + (toTop.y + Math.min(24, toTop.height / 2) - (fromTop.y + fromTop.height / 2)) * t;
      await page.mouse.move(cx, cy);
    }
    // Ghost follows via the board's onDrag, positioned in frame-relative coords.
    const gx = fromIn.x + (toIn.x - fromIn.x) * t;
    const gy = fromIn.y + (toIn.y - fromIn.y) * t;
    await source.dispatchEvent('drag', { clientX: gx, clientY: gy, dataTransfer: dt }).catch(() => {});
    if (i % 6 === 0) await target.dispatchEvent('dragover', { dataTransfer: dt }).catch(() => {});
    await page.waitForTimeout(16);
  }

  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await page.waitForTimeout(100);
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await source.dispatchEvent('dragend', { dataTransfer: dt }).catch(() => {});
  await dt.dispose();
  await page.waitForTimeout(400);

  // Backstop for the host's one-time DELETE consent prompt (drag-to-backlog removes
  // an issue from the sprint). Global setup pre-authorizes off-camera, so this should
  // never fire during a reel — but a stalled prompt would otherwise freeze the take.
  const allow = page.getByRole('button', { name: /Allow and don't ask again/i });
  if (await allow.isVisible().catch(() => false)) {
    await allow.click().catch(() => {});
    await page.waitForTimeout(600);
  }
}

/**
 * Reset the live YouTrack to the fixed, prepared demo state so every reel is recorded against
 * identical data (req: "always use the same data, prepared in the beginning"). Runs the same
 * wipe-and-seed script as global setup; called from each reel's beforeAll so the reels are
 * independent of order and of anything a previous reel changed.
 */
export function resetDemoState(): void {
  const r = spawnSync('node', ['scripts/setup-youtrack-demo.mjs'], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('resetDemoState: setup-youtrack-demo.mjs failed');
}

/** Console/page-error guard; ignores benign YouTrack noise. Returns an assert to call at the end. */
export function guardErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => {
    const real = errors.filter((e) => !/favicon|ResizeObserver|net::ERR_ABORTED|Failed to load resource/i.test(e));
    expect(real, `page errors:\n${real.join('\n')}`).toHaveLength(0);
  };
}
