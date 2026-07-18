/**
 * Install (or update) the packed app into a running real YouTrack via the admin UI's
 * "Upload ZIP file" (the REST upload endpoint rejects multipart). Requires the instance
 * URL + admin credentials via env. Idempotent: re-uploading updates the existing app.
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const ZIP = path.resolve(process.env.APP_ZIP ?? 'dist/sprint-capacity-planner.zip');
const CLEAN = process.env.APP_CLEAN_INSTALL !== 'false';
const TOKEN =
  process.env.YT_TEST_ADMIN_TOKEN ??
  (() => {
    try { return readFileSync('/tmp/yt25-token.txt', 'utf8').trim(); } catch { return ''; }
  })();

/** Delete any existing install so AppGlobalStorage (token + state) starts clean. */
async function deleteExisting() {
  if (!CLEAN || !TOKEN) return;
  const h = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' };
  try {
    const res = await fetch(`${B}/api/admin/apps?fields=id,name&$top=300`, { headers: h });
    const apps = await res.json();
    for (const a of Array.isArray(apps) ? apps : []) {
      if (a.name === 'sprint-capacity-planner') {
        await fetch(`${B}/api/admin/apps/${a.id}`, { method: 'DELETE', headers: h });
      }
    }
  } catch { /* ignore */ }
}
await deleteExisting();
const br = await chromium.launch();
const p = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let err = '';
p.on('response', async (r) => {
  if (/apps/i.test(r.url()) && r.request().method() === 'POST' && r.status() >= 400) {
    try { err = (await r.text()).slice(0, 300); } catch { /* ignore */ }
  }
});
await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2200);
const u = await p.$('input#username') || await p.$('input[type=text]');
if (u) { await u.fill(USER); await (await p.$('input[type=password]')).fill(PASS); await (await p.$('button[type=submit]')).click(); await p.waitForTimeout(4000); }
await p.goto(`${B}/admin/apps`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
await p.getByRole('button', { name: /Add app/i }).click(); await p.waitForTimeout(1000);
const [c] = await Promise.all([p.waitForEvent('filechooser', { timeout: 9000 }), p.getByText(/Upload ZIP file/i).first().click()]);
await c.setFiles(ZIP); await p.waitForTimeout(9000);
const body = (await p.textContent('body')) || '';
console.log(JSON.stringify({ ok: /sprint-capacity-planner/i.test(body) && !err, error: err || null }));
await br.close();
