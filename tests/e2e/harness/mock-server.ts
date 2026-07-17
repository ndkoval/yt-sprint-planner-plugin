/**
 * Demo/E2E HTTP harness: serves the real built widget bundles and mounts the REAL
 * backend against the in-memory {@link FakeYouTrack} world. This lets Playwright drive
 * the actual plugin UI end-to-end (and record it) without depending on a live YouTrack.
 *
 * Persona: the served page reads `?as=<login>` and sets a `demo_as` cookie; the backend
 * resolves the caller from that cookie (mapping to a seeded user id), so member-vs-manager
 * behaviour and own-row editing are exercised for real. Requests are serialised so the
 * shared fake's per-request current user cannot race.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../../src/backend/app.js';
import { fixedClock } from '../../../src/backend/clock.js';
import type { HttpMethod } from '../../../src/backend/http/router.js';
import { ConfigRepository } from '../../../src/backend/repositories/config-repository.js';
import { SprintRepository } from '../../../src/backend/repositories/sprint-repository.js';
import { ReconciliationService } from '../../../src/backend/services/reconciliation-service.js';
import { buildDemoWorld, DEMO, PERSONAS } from './seed.js';

const API_BASE = '/api/apps/sprint-capacity-planner/backend';
// The harness is esbuild-bundled to dist/demo, so import.meta.url is unreliable for
// locating source dirs. The widgets dir is passed explicitly (serve-demo sets it),
// defaulting to the built widgets under the current working directory.
const WIDGETS_DIR =
  process.env.DEMO_WIDGETS_DIR ?? path.join(process.cwd(), 'dist', 'widgets');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Map a `?as=` login to a seeded user id (defaults to the manager). */
function personaId(login: string | null): string {
  if (login && PERSONAS[login]) return PERSONAS[login].id;
  return PERSONAS.manager.id;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Inject a tiny host shim so the widget's WindowHostBridge resolves the current user
 * and persists the persona cookie for backend calls. The bridge already falls back to
 * a same-origin fetch against API_BASE and reads projectId from the query string.
 */
/**
 * A minimal stand-in for the native YouTrack agile board that "Open board" opens. It
 * lists each Sprint's issues (from the demo issues endpoint) and links back into the
 * Sprint Capacity planner for that Sprint. Enough to demo "how issues look with the
 * current Sprints" and "go to a Sprint from there".
 */
function boardStubHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>AppGlass Board</title>
<style>
  body{font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;color:#1f2326;background:#f7f8fa}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#737577;margin:0 0 20px}
  .sprint{background:#fff;border:1px solid #dfe1e6;border-radius:8px;padding:16px;margin-bottom:16px}
  .sprint h2{font-size:16px;margin:0 0 8px}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;font-size:13px}
  th{color:#737577;font-weight:600} .resolved{color:#3a923a} .open{color:#1a73e8}
  a.open-planner{display:inline-block;margin-top:10px;color:#1a73e8;text-decoration:none;font-weight:600}
</style></head>
<body>
  <h1>AppGlass Board</h1>
  <p class="sub">Native agile board — issues grouped by Sprint. Open one in the Sprint Capacity planner.</p>
  <div id="board" aria-live="polite">Loading…</div>
<script>
(async function(){
  var api='/api/apps/sprint-capacity-planner/backend';
  var as=(document.cookie.match(/demo_as=([^;]+)/)||[])[1]||'manager';
  var sprints=await (await fetch(api+'/sprints?projectId=proj-demo')).json();
  var root=document.getElementById('board'); root.innerHTML='';
  for (var i=0;i<sprints.length;i++){
    var s=sprints[i];
    var issues=await (await fetch('/__demo/issues?sprintId='+encodeURIComponent(s.id))).json();
    var mins=function(m){return m==null?'—':(Math.round((m/480)*100)/100)+'d';};
    var rowsHtml=issues.map(function(it){
      return '<tr><td>'+it.id+'</td><td>'+mins(it.originalEffortMinutes)+'</td><td>'+mins(it.currentEffortMinutes)+
        '</td><td class="'+(it.resolved?'resolved':'open')+'">'+(it.resolved?'Resolved':'Open')+'</td></tr>';
    }).join('');
    var sec=document.createElement('div'); sec.className='sprint'; sec.setAttribute('data-sprint',s.id);
    sec.innerHTML='<h2>'+s.name+'</h2>'+
      '<table aria-label="Issues in '+s.name+'"><thead><tr><th>Issue</th><th>Original</th><th>Current</th><th>State</th></tr></thead>'+
      '<tbody>'+(rowsHtml||'<tr><td colspan=4>No issues</td></tr>')+'</tbody></table>'+
      '<a class="open-planner" href="/project-tab/index.html?projectId=proj-demo&as='+as+'&sprint='+encodeURIComponent(s.id)+'">Open “'+s.name+'” in Sprint Capacity →</a>';
    root.appendChild(sec);
  }
})();
</script>
</body></html>`;
}

/**
 * A simulated YouTrack "Install app" admin screen for the installation demo reel. It
 * mirrors the real flow — upload the packaged ZIP, install, attach to a project, open
 * settings — without needing a live YouTrack (which can't run its scripting engine on
 * this platform). Clearly labelled as a simulation.
 */
function installStubHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Install app — YouTrack (simulated)</title>
<style>
  body{font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:28px;color:#1f2326;background:#f7f8fa}
  .sim{position:fixed;top:10px;right:14px;font-size:11px;color:#8a8d90;letter-spacing:.04em}
  h1{font-size:20px;margin:0 0 2px} .sub{color:#737577;margin:0 0 22px}
  .card{background:#fff;border:1px solid #dfe1e6;border-radius:10px;padding:20px;max-width:640px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f3}
  .row:last-child{border-bottom:0}
  .key{color:#737577} .val{font-weight:600}
  .drop{margin:16px 0;padding:22px;border:2px dashed #c3c7cd;border-radius:10px;text-align:center;color:#737577}
  button{font:inherit;font-weight:600;color:#fff;background:#1a73e8;border:0;border-radius:8px;padding:9px 16px;cursor:pointer}
  button.secondary{background:#fff;color:#1a73e8;border:1px solid #1a73e8}
  .status{margin-top:14px;font-weight:600}
  .ok{color:#3a923a}
  a{color:#1a73e8;text-decoration:none;font-weight:600}
</style></head>
<body>
  <div class="sim">simulated install screen</div>
  <h1>Install app</h1>
  <p class="sub">Administration → Apps → Install app from ZIP</p>
  <div class="card">
    <div class="row"><span class="key">App</span><span class="val">Sprint Capacity Planner</span></div>
    <div class="row"><span class="key">Version</span><span class="val">0.1.0</span></div>
    <div class="row"><span class="key">Package</span><span class="val">dist/sprint-capacity-planner.zip</span></div>
    <div class="row"><span class="key">Scopes</span><span class="val">Agile.Read, Agile.Update, Issue.Read, Project.Read</span></div>
    <div class="drop" id="drop">Drop <b>sprint-capacity-planner.zip</b> here, or</div>
    <div style="display:flex;gap:10px;align-items:center">
      <button id="install">Install</button>
      <button class="secondary" id="attach" style="display:none">Attach to project “AppGlass”</button>
      <a id="open" href="/project-settings/index.html?projectId=proj-demo&as=manager" style="display:none">Open Sprint Capacity Settings →</a>
    </div>
    <div class="status" id="status"></div>
  </div>
<script>
(function(){
  var status=document.getElementById('status');
  document.getElementById('install').addEventListener('click',function(){
    this.disabled=true; status.textContent='Installing…';
    setTimeout(function(){
      status.innerHTML='<span class="ok">✓ Installed — Sprint Capacity Planner 0.1.0</span>';
      document.getElementById('attach').style.display='';
    },600);
  });
  document.getElementById('attach').addEventListener('click',function(){
    this.disabled=true; status.innerHTML='<span class="ok">✓ Installed and attached to “AppGlass”</span>';
    document.getElementById('open').style.display='';
  });
})();
</script>
</body></html>`;
}

function injectHostShim(html: string): string {
  const shim = `<script>(function(){
    var as = new URLSearchParams(location.search).get('as') || 'manager';
    document.cookie = 'demo_as=' + as + '; path=/';
    var ids = ${JSON.stringify(
      Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, v.id])),
    )};
    window.YTApp = { me: { id: ids[as] || ids.manager } };
  })();</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${shim}</head>`) : shim + html;
}

export async function startMockServer(port: number): Promise<{ close: () => Promise<void> }> {
  const clock = fixedClock(DEMO.now);
  // The world is swappable so `/__demo/reset` can restore the exact seeded baseline
  // before each test — keeping the E2E deterministic and independent of run order.
  let world = await buildDemoWorld();
  let demoIssueSeq = 0;
  // A delegating proxy so the app always talks to the CURRENT world after a reset.
  const client = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) =>
          (world as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]!(...args);
      },
    },
  ) as unknown as typeof world;
  const app = createApp({ client, clock });

  /**
   * Demo-only hook: add a task to a Sprint and reconcile it, exactly as the on-change
   * workflow + authoritative reconciliation would do automatically when an issue is
   * added/estimated on the board. Lets the E2E prove that remaining capacity updates
   * without any manual action in the app.
   */
  async function demoAddIssue(
    sprintId: string,
    originalMinutes: number,
    currentMinutes: number,
    assigneeId: string | null,
  ) {
    const existing = await world.getSprintIssues(DEMO.boardId, sprintId, '', '');
    demoIssueSeq += 1;
    world.seedIssues(DEMO.boardId, sprintId, [
      ...existing,
      {
        id: `AG-DEMO-${demoIssueSeq}`,
        originalEffortMinutes: originalMinutes,
        currentEffortMinutes: currentMinutes,
        resolved: false,
        resolvedAt: null,
        assigneeId,
      },
    ]);
    const config = (await new ConfigRepository(world, DEMO.projectId).load()).config;
    if (!config) throw new Error('demo project is not configured');
    const repo = new SprintRepository(world, DEMO.boardId);
    const sprint = await world.getSprint(DEMO.boardId, sprintId);
    if (!sprint) throw new Error(`no sprint ${sprintId}`);
    const record = await repo.load(sprint, DEMO.projectId);
    await new ReconciliationService(world, repo, clock).reconcile(record, config, DEMO.boardId, null);
  }

  // Serialise requests: the shared fake carries a single current-user field.
  let queue: Promise<unknown> = Promise.resolve();
  const serialise = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: String(err) }));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // ---- Demo: reset the world to the seeded baseline (test isolation) ----
    if (url.pathname === '/__demo/reset') {
      await serialise(async () => {
        world = await buildDemoWorld();
        demoIssueSeq = 0;
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ---- Demo: issues in a Sprint (backs the board stub below) ----
    if (url.pathname === '/__demo/issues') {
      const sprintId = url.searchParams.get('sprintId') ?? 'sprint-2';
      const issues = await world.getSprintIssues(DEMO.boardId, sprintId, '', '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(issues));
      return;
    }

    // ---- Install stub: the simulated "Install app" admin screen for the install reel. ----
    if (url.pathname === '/install') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(installStubHtml());
      return;
    }

    // ---- Board stub: what "Open board" opens. Lists each Sprint's issues and links
    // back into the planner for that Sprint (so you can "go to a Sprint from there"). ----
    if (url.pathname.startsWith('/agiles/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(boardStubHtml());
      return;
    }

    // ---- Demo hook: simulate the board+workflow adding/estimating a task ----
    if (url.pathname === '/__demo/add-issue') {
      const sprintId = url.searchParams.get('sprintId') ?? 'sprint-2';
      const original = Number(url.searchParams.get('originalMinutes') ?? 2400);
      const current = Number(url.searchParams.get('currentMinutes') ?? 2400);
      const as = url.searchParams.get('assigneeId');
      await serialise(() => demoAddIssue(sprintId, original, current, as && as.length > 0 ? as : null));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ---- API ----
    if (url.pathname.startsWith(API_BASE)) {
      const cookies = parseCookies(req.headers.cookie);
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      const bodyText = await readBody(req);
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
      const result = await serialise(() => {
        world.currentUserId = personaId(cookies.demo_as ?? null);
        return app.handle({
          method: (req.method ?? 'GET') as HttpMethod,
          path: url.pathname.slice(API_BASE.length) || '/',
          query,
          body,
        });
      });
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    // ---- Static widgets ----
    // "/" → the project tab; "/settings" → the settings widget.
    let rel = url.pathname;
    if (rel === '/' || rel === '') rel = '/project-tab/index.html';
    else if (rel === '/settings' || rel === '/settings/') rel = '/project-settings/index.html';
    const filePath = path.join(WIDGETS_DIR, rel.replace(/^\/+/, ''));
    if (!filePath.startsWith(WIDGETS_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const ext = path.extname(filePath);
      let content: Buffer | string = await readFile(filePath);
      if (ext === '.html') content = injectHostShim(content.toString('utf8'));
      res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  }

  await new Promise<void>((resolve) => server.listen(port, resolve));
  // eslint-disable-next-line no-console
  console.log(`[demo] serving widgets + mock backend on http://localhost:${port}`);
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

// Allow running directly: `node <bundle> [port]`.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.DEMO_PORT ?? process.argv[2] ?? 8090);
  startMockServer(port).catch((e: unknown) => {
    console.error('[demo] failed to start:', e);
    process.exit(1);
  });
}
