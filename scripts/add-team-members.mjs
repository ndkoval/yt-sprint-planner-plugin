/**
 * add-team-members — add users to a project's team via the UI (REST/Hub don't expose it),
 * so they become assignable. Idempotent. Env: YT_TEST_BASE_URL, creds, PROJECT_KEY,
 * MEMBER_NAMES (comma-separated display names; default Alice/Bob/Charlie/Dana/Erin).
 *
 * The Add-members dialog lists users (option text is "<name><login>…"); we filter by name,
 * click the match to select it, then click Invite once to commit all selections.
 */
import { chromium } from '@playwright/test';

const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const PROJECT_KEY = process.env.PROJECT_KEY ?? 'AGP';
const NAMES = (process.env.MEMBER_NAMES ?? 'Alice Smith,Bob Jones,Charlie Diaz,Dana Lee,Erin Park')
  .split(',').map((s) => s.trim()).filter(Boolean);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const selected = [];
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
      await search.click();
      await search.fill(name);
      await p.waitForTimeout(1300);
      // The option row starts with the display name (followed by login/email, no space).
      const opt = p.getByText(new RegExp(`^${esc(name)}(?!.*Team member)`)).first();
      await opt.click({ timeout: 5000 });
      selected.push(name);
      await p.waitForTimeout(500);
      await search.fill('');
      await p.waitForTimeout(300);
    } catch {
      /* already a member or not found */
    }
  }
  // Commit. The dialog's confirm is "Invite" (users already exist, so no email invite is sent).
  const invite = p.getByRole('button', { name: /^Invite$/ });
  if ((await invite.count()) > 0) {
    await invite.first().click({ timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(2500);
  }
  // Verify: re-read the team page and report who is now a member.
  await p.goto(`${B}/projects/${PROJECT_KEY}?tab=team`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const body = (await p.textContent('body')) || '';
  const onTeam = NAMES.filter((n) => body.includes(n));
  console.log(JSON.stringify({ selected, onTeam }));
} catch (e) {
  console.log(JSON.stringify({ selected, error: String(e.message).slice(0, 140) }));
} finally {
  await br.close();
}
