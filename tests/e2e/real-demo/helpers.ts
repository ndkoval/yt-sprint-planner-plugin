/**
 * Helpers for the REAL-YouTrack demo suite. The app runs as installed widgets inside a
 * real YouTrack project (in a nested iframe) plus the native Kanban board. These helpers
 * open the app widget and return its {@link Frame} so journeys can drive the real app UI,
 * while the cursor + caption overlays live in the top YouTrack page.
 *
 * The generic recording helpers (Captioner, cursor motion, title cards) are shared with the
 * mock demo suite; only the navigation/frame plumbing is real-YouTrack-specific.
 */
import { test as base, expect, type Page, type Frame } from '@playwright/test';
import { CURSOR_INIT_SCRIPT } from '../demo/cursor.js';

export {
  Captioner,
  showTitleCard,
  closeTitleCard,
  settle,
  moveTo,
  humanClick,
  humanFill,
  estNarrationMs,
} from '../demo/helpers.js';
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
  const url = `/projects/${PROJECT_KEY}?${params.toString()}`;
  if (opts.cap && opts.intro) {
    // Start navigating (the card paints at document-start) and narrate over the load without
    // waiting for the whole YouTrack SPA — keeps the intro card's dead-air short.
    const nav = page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(950);
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

/** Console/page-error guard; ignores benign YouTrack noise. Returns an assert to call at the end. */
export function guardErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => {
    const real = errors.filter((e) => !/favicon|ResizeObserver|net::ERR_ABORTED|Failed to load resource/i.test(e));
    expect(real, `page errors:\n${real.join('\n')}`).toHaveLength(0);
  };
}
