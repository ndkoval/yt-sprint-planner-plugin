/**
 * add-team-members — add users to a project's team via the UI (REST/Hub don't expose it),
 * so they become assignable. Idempotent. Env: YT_TEST_BASE_URL, creds, PROJECT_KEY, MEMBERS
 * (comma-separated logins; default alice,bob,charlie).
 */
import { chromium } from '@playwright/test';

const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const PROJECT_KEY = process.env.PROJECT_KEY ?? 'AGP';
// Display names to select in the Add-members dialog.
const NAMES = (process.env.MEMBER_NAMES ?? 'Alice Smith,Bob Jones,Charlie Diaz').split(',').map((s) => s.trim()).filter(Boolean);

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const added = [];
try {
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const u = (await p.$('input#username')) || (await p.$('input[type=text]'));
  if (u) {
    await u.fill(USER);
    await (await p.$('input[type=password]')).fill(PASS);
    await (await p.$('button[type=submit]')).click();
    await p.waitForTimeout(4000);
  }
  await p.goto(`${B}/projects/${PROJECT_KEY}?tab=team`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  await p.getByRole('button', { name: /Add members/i }).click();
  await p.waitForTimeout(1200);
  const search = p.getByPlaceholder(/Select users|enter an email/i);
  for (const name of NAMES) {
    try {
      await search.fill(name);
      await p.waitForTimeout(1500);
      await p.getByText(name, { exact: true }).first().click({ timeout: 4000 });
      await p.waitForTimeout(600);
      added.push(name);
    } catch {
      /* not found / already added */
    }
  }
  const invite = p.getByRole('button', { name: /^Invite$|^Add/i });
  if ((await invite.count()) && (await invite.first().isEnabled().catch(() => false))) {
    await invite.first().click();
    await p.waitForTimeout(2500);
  }
  await p.screenshot({ path: '/tmp/team-after.png' });
  console.log(JSON.stringify({ added }));
} catch (e) {
  console.log(JSON.stringify({ added, error: String(e.message).slice(0, 140) }));
} finally {
  await br.close();
}
