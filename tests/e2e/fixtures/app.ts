/**
 * Navigation + widget-frame helpers for the E2E suite, verified against a real
 * YouTrack 2025.3: the app's PROJECT_SETTINGS widget lives at
 *   /projects/<KEY>?tab=<appName>%3A<widgetName>   (URL-encoded "app:Widget name")
 * and renders inside a sandboxed `srcdoc` iframe. The widget root carries
 * data-test="scp-ready" once the planner has loaded (the settings panel carries
 * data-test="scp-settings"); empty/error states render distinctive text instead.
 */
import type { Frame, Page } from '@playwright/test';
import { seedManifest, type SeededTeam } from './personas';

/**
 * The two seeded e2e projects (see scripts/seed-e2e.mjs). Since config v4 each
 * TEAM owns its board/sprint — the identities live on the team entries.
 */
export const PROJECTS = {
  one: seedManifest.projects?.one ?? {
    key: 'SCPE1',
    projectId: '',
    teams: [
      { id: 'team-1', name: 'Alpha', boardId: '', sprintId: '', sprintName: 'Alpha S1' },
      { id: 'team-2', name: 'Beta', boardId: '', sprintId: '', sprintName: 'Beta S1' },
    ],
  },
  two: seedManifest.projects?.two ?? {
    key: 'SCPE2',
    projectId: '',
    teams: [{ id: 'team-1', name: 'Team 1', boardId: '', sprintId: '', sprintName: 'Two S1' }],
  },
};

/** A seeded project's team by id or name (throws when the seed lacks it). */
export function teamOf(
  project: { teams: SeededTeam[] },
  idOrName: string,
): SeededTeam {
  const team = project.teams.find((t) => t.id === idOrName || t.name === idOrName);
  if (!team) throw new Error(`Seed manifest has no team "${idOrName}"`);
  return team;
}

/** The project-settings tab that hosts the planner widget (project admins only). */
export function plannerUrl(projectKey: string): string {
  return `/projects/${projectKey}?tab=sprint-capacity-planner%3ASprint+Capacity`;
}

/** The main-menu placement — how TEAM MEMBERS reach the planner (project picker inside). */
export const MENU_PLANNER_URL = '/app/sprint-capacity-planner/sprint-capacity-menu';

const FRAME_MARKER =
  '[data-test="scp-ready"], [data-test="scp-settings"], [data-test="scp-project-picker"]';
const FRAME_TEXT =
  /Not configured yet|Loading Sprint capacity|Sprint Capacity Planner could not start|No Sprint selected|Unable to load/;

/**
 * The widget's iframe, once its content is recognizably ours. YouTrack embeds the
 * widget in a srcdoc iframe with no stable id, so we scan frames for our markers.
 */
export async function plannerFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if ((await frame.locator(FRAME_MARKER).count()) > 0) return frame;
        const body = await frame.locator('body').textContent({ timeout: 500 });
        if (body !== null && FRAME_TEXT.test(body)) return frame;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Sprint Capacity widget frame not found within ${timeoutMs}ms. ${lastError}`);
}

/** Open the planner for a project and wait for the loaded planner UI. */
export async function openPlanner(page: Page, projectKey: string): Promise<Frame> {
  await page.goto(plannerUrl(projectKey), { waitUntil: 'domcontentloaded' });
  const frame = await plannerFrame(page);
  await frame.locator('[data-test="scp-ready"]').waitFor({ state: 'visible', timeout: 30_000 });
  return frame;
}

/**
 * Open the planner through the MAIN MENU placement (the members' path — the
 * project-settings tab is only served to project admins) and bind it to a project:
 * picks it in the in-widget project picker, or switches when a previous test left
 * another project remembered.
 */
export async function openPlannerViaMenu(page: Page, projectKey: string): Promise<Frame> {
  await page.goto(MENU_PLANNER_URL, { waitUntil: 'domcontentloaded' });
  const frame = await plannerFrame(page);
  const choice = frame.locator(`[data-test="scp-project-choice"][data-project="${projectKey}"]`);
  const picker = frame.locator('[data-test="scp-project-picker"]');
  const ready = frame.locator('[data-test="scp-ready"]');
  await picker.or(ready).first().waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await picker.isVisible())) {
    // A previously remembered project loaded directly — re-open the picker so this
    // helper always lands on the requested project.
    await frame.getByRole('button', { name: 'Switch project' }).click();
    await picker.waitFor({ state: 'visible', timeout: 15_000 });
  }
  await choice.click();
  await ready.waitFor({ state: 'visible', timeout: 30_000 });
  return frame;
}

/** Open the planner and go straight to the embedded Settings panel (managers only). */
export async function openSettings(page: Page, projectKey: string): Promise<Frame> {
  const frame = await openPlanner(page, projectKey);
  await frame.getByRole('button', { name: 'Settings', exact: true }).click();
  await frame.locator('[data-test="scp-settings"]').waitFor({ state: 'visible', timeout: 15_000 });
  return frame;
}

/**
 * Open a Ring UI Select (it renders as a role=combobox button named by its label,
 * plus a separate chevron button) and return its popup for option assertions/clicks.
 */
export async function openRingSelect(
  frame: Frame,
  name: string | RegExp,
): Promise<ReturnType<Frame['locator']>> {
  await frame.getByRole('combobox', { name }).click();
  const popup = frame.locator('[data-test="ring-popup"]');
  await popup.waitFor({ state: 'visible', timeout: 10_000 });
  return popup;
}

/**
 * Approve YouTrack's app-request consent prompt if it appears. The host interposes
 * a per-user confirmation ("…attempting to make a DELETE request to the "agiles"
 * endpoint…") the first time an app issues a DELETE — e.g. removing an issue from
 * a sprint. Clicking "Allow and don't ask again" lets the held request proceed.
 */
export async function approveAppRequest(page: Page): Promise<void> {
  const allow = page.getByRole('button', { name: /Allow and don't ask again/i });
  try {
    await allow.waitFor({ state: 'visible', timeout: 5_000 });
    await allow.click();
  } catch {
    /* no prompt (already granted) */
  }
}

/**
 * HTML5 drag-and-drop inside the widget frame. Raw mouse moves do NOT fire the
 * HTML5 drag events the board listens to, so we dispatch dragstart/dragover/drop/
 * dragend with a DataTransfer created in the frame (same technique as the demo reels).
 */
export async function dragTo(frame: Frame, sourceSelector: string, targetSelector: string): Promise<void> {
  await frame.locator(sourceSelector).first().waitFor({ state: 'visible' });
  await frame.locator(targetSelector).first().waitFor({ state: 'visible' });
  await frame.evaluate(
    ({ sourceSel, targetSel }) => {
      const source = document.querySelector(sourceSel);
      const target = document.querySelector(targetSel);
      if (!source || !target) throw new Error(`drag: missing ${!source ? sourceSel : targetSel}`);
      // dataTransfer must travel via the constructor init — the property is a getter.
      const dt = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const at = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
      source.dispatchEvent(new DragEvent('dragstart', opts));
      target.dispatchEvent(new DragEvent('dragover', { ...opts, ...at }));
      target.dispatchEvent(new DragEvent('drop', { ...opts, ...at }));
      source.dispatchEvent(new DragEvent('dragend', opts));
    },
    { sourceSel: sourceSelector, targetSel: targetSelector },
  );
}
