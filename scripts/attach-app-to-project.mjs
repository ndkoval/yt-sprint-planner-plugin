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
  await p.goto(`${B}/projects/${PROJECT_KEY}?tab=apps`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  const body = (await p.textContent('body')) || '';
  if (new RegExp(APP_TITLE, 'i').test(body)) {
    console.log(JSON.stringify({ attached: true, alreadyAttached: true }));
  } else {
    await p.getByRole('button', { name: /Add app/i }).click();
    await p.waitForTimeout(900);
    await p.getByText(/^Attach app$/).click();
    await p.waitForTimeout(1200);
    await p.getByPlaceholder(/Filter items/i).fill(APP_TITLE);
    await p.waitForTimeout(1500);
    await p.getByText(new RegExp(APP_TITLE, 'i')).first().click();
    await p.waitForTimeout(3500);
    const after = (await p.textContent('body')) || '';
    console.log(JSON.stringify({ attached: new RegExp(APP_TITLE, 'i').test(after) }));
  }
} catch (e) {
  console.log(JSON.stringify({ attached: false, error: String(e.message).slice(0, 140) }));
} finally {
  await br.close();
}
