/**
 * attach-app-to-project — attach the installed app to a project via the admin UI (the REST
 * attach endpoint isn't exposed), so its PROJECT_SETTINGS widgets appear in the project.
 * Idempotent: if already attached, it's a no-op. Env: YT_TEST_BASE_URL, creds, PROJECT_KEY.
 */
import { chromium } from '@playwright/test';

const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const PROJECT_KEY = process.env.PROJECT_KEY ?? 'AGP';
const APP_TITLE = process.env.APP_TITLE ?? 'Sprint Capacity Planner';

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
try {
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const u = (await p.$('input#username')) || (await p.$('input[type=text]'));
  if (u) {
    await u.fill(USER);
    await (await p.$('input[type=password]')).fill(PASS);
    await (await p.$('button[type=submit]')).click();
    await p.waitForTimeout(4000);
  }
  // Verify by the widget sidebar item ("Sprint Capacity"), not just the title text.
  const isAttached = async () => {
    await p.goto(`${B}/projects/${PROJECT_KEY}?tab=apps`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    return (await p.getByText(/^Sprint Capacity$/).count()) > 0;
  };
  let attached = await isAttached();
  for (let i = 0; i < 4 && !attached; i += 1) {
    try {
      await p.getByRole('button', { name: /Add app/i }).click();
      await p.waitForTimeout(1000);
      await p.getByText(/^Attach app$/).click();
      await p.waitForTimeout(1200);
      await p.getByPlaceholder(/Filter items/i).fill(APP_TITLE);
      await p.waitForTimeout(1600);
      await p.getByText(new RegExp(APP_TITLE, 'i')).first().click();
      await p.waitForTimeout(3500);
    } catch {
      await p.keyboard.press('Escape').catch(() => {});
    }
    attached = await isAttached(); // reload + re-check (attach can lag)
  }
  console.log(JSON.stringify({ attached }));
  if (!attached) process.exitCode = 1;
} catch (e) {
  console.log(JSON.stringify({ attached: false, error: String(e.message).slice(0, 140) }));
} finally {
  await br.close();
}
