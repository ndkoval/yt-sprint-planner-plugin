# Architecture

How the Sprint Capacity Planner is structured and the invariants that keep it correct. See [`README.md`](README.md) for the product overview, [`DATA_MODEL.md`](DATA_MODEL.md) for the persisted shapes, [`SECURITY.md`](SECURITY.md) for authorization.

---

## Native Sprint as the single source of truth

The app **never** owns a Sprint object. Every managed Sprint is a *native* YouTrack Sprint. Its `name`, `goal`, `start`, `finish` and its **membership** (which issues are in it) live in YouTrack and are read/written through the **current user's REST session** ([`src/widgets/youtrack-client.ts`](src/widgets/youtrack-client.ts)). Everything the app adds — config, teams, per-team capacity and Focus Factor — lives in three `scp*` extension properties on the **Project**.

Consequences: no service issues, no shadow Sprint records, no metric caches; uninstalling removes only `scp*` properties.

---

## Layering

```
┌────────────────────────────────────────────────────────────────────────┐
│  Widgets (iframe UI)                                    src/widgets/    │
│  bootstrap.tsx → host.ts (eager YTApp.register)                         │
│  project-tab/SprintCapacityTab.tsx · project-settings/SettingsForm.tsx  │
│  components/* (Ring UI)                                                 │
│                                                                         │
│  api-client.ts (ApiClient) composes:                                    │
│   ├─ youtrack-client.ts  ── host.fetchYouTrack ──►  native YouTrack     │
│   │    (current user's REST session; real permissions)                  │
│   ├─ sprint-view.ts      ── compute-on-read SprintView (domain math)    │
│   └─ host.fetchApp ────────────────────────────────►  app backend       │
└────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────┐
│  Backend (in-process app handlers)                      src/backend/    │
│  index.ts    global-scoped endpoints, ?project=<KEY>, 200 {ok} envelope │
│  handlers.ts app-state logic + server-side authz (ctx.currentUser)      │
│  storage.ts  scpConfigJson / scpSprintDataJson, migrate-on-read         │
│  env.ts      BackendEnv seam (real: scripting-api entities; tests: fake)│
└────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────┐
│  Pure domain library                                    src/domain/     │
│  dates · capacity · effort · focus-factor · metrics · sprint/naming ·   │
│  teams · permissions · migrations                                       │
└────────────────────────────────────────────────────────────────────────┘
   Shared contracts: src/shared/ (types · schemas · api · api-schemas · units)
   One workflow rule: src/workflows/workflow-availability-reminder.js
```

- **Shared** ([`src/shared`](src/shared)) — TypeScript types, zod schemas for every persisted document and request body, the API contracts, the units policy. Schemas are the validation source of truth; a compile-time check fails the build if types drift.
- **Domain** ([`src/domain`](src/domain)) — pure, side-effect-free calculation functions, imported by the backend *and* the widgets (same math everywhere). Unit-tested to a ≥95% coverage gate.
- **Backend** ([`src/backend`](src/backend)) — in-process request handlers over **Project extension properties**. Endpoints are global-scoped and take the project key via `?project=`; the handler resolves the Project with `entities.Project.findByKey` and authorizes from `ctx.currentUser` (manager = project leader or YouTrack's own `UPDATE_PROJECT` permission via `hasPermission` — no app permission scheme; see [`SECURITY.md`](SECURITY.md)). Handlers reach YouTrack only through the tiny `BackendEnv` seam ([`env.ts`](src/backend/env.ts)), so contract tests drive them with a fake ([`tests/contract/fake-env.ts`](tests/contract/fake-env.ts)). Native data is deliberately absent from this layer.
- **Widgets** ([`src/widgets`](src/widgets)) — register with the host eagerly ([`host.ts`](src/widgets/host.ts)), then drive everything through the typed [`ApiClient`](src/widgets/api-client.ts), which composes native REST reads/writes, backend app-state calls, and locally computed views. Four manifest entry points render the same planner: the `PROJECT_SETTINGS` tab (planning + manager configuration in one place), a `MAIN_MENU_ITEM` entry ([`menu-planner/`](src/widgets/menu-planner)) — a direct, project-independent way in, with an in-widget project picker (the caller's visible projects only; last choice remembered **server-side per user** via the `prefs` endpoints over the `scpPrefsJson` User property, `localStorage` being only a best-effort fallback in the sandboxed `srcdoc` iframe) that binds the client late (`hostHasProjectContext`/`useProject`/`listProjects`) — plus the issue options menu and the dashboard. UX notes: double-clicking a board card opens the issue in a **wide (≤1080 px) panel anchored at the card** inside the widget iframe with a dimmed backdrop (no host modal mode); field values edit through Ring UI inline selects; issue ids link to the native issue view in a new tab (from the overlay and from board cards); the sprint selector deliberately has no filter box (its autofocus scrolled the host page). Two platform pitfalls, both verified on 2025.3: a `PROJECT_TAB` extension point does **not** exist (import rejected; absent from the official extension-points reference), and manifest widgets must have **distinct names** — YouTrack resolves the settings-tab URL by `app:WIDGET-NAME`, so a duplicate name breaks the tab (see [`manifest.json`](manifest.json)).

The backend is bundled to a single root-level `backend.js` (CommonJS, zod bundled in — [`scripts/build-backend.mjs`](scripts/build-backend.mjs)); the workflow module is copied to the package root ([`scripts/build.mjs`](scripts/build.mjs)).

---

## The teams dimension

Teams are small groups planning independently **within** a project; all teams share the board and Sprint cadence.

- **Where it lives:** `ProjectConfig.teams` (1..20, each `{id, name, participants, backlogQuery?}`) in `scpConfigJson`; per-Sprint per-team planning state (`capacityRevision`, capacity document, Focus Factor, calibration) in `SprintEntry.teams[teamId]` in `scpSprintDataJson`.
- **Attribution:** an issue counts toward **every** team its **assignee** is a member of ([`src/domain/teams/teams.ts`](src/domain/teams/teams.ts)). The same person may be in several teams (shared specialists), with an independent capacity row and allocation per team — so per-team metrics may overlap, while Sprint totals still count each issue exactly once. Unassigned issues belong to no team and count only in Sprint totals.
- **API:** team-scoped mutations take an optional `teamId` — omitted, it resolves to the config's only team (single-team projects and older scripts keep working); ambiguous in a multi-team project → `VALIDATION_FAILED`.
- **Calibration:** each team's Focus Factor calibrates from that team's own completed Sprints (its member-attributed issues vs. its own capacity); `learningRate` is shared. Computed client-side in `ApiClient.computeNextTeamFocusFactors` and seeded through `sprint-register`.
- **Lifecycle:** saving settings reconciles **all** managed Sprints immediately (new teams seeded, new participants' rows backfilled), so roster changes appear on the planner right away; teams still missing an entry (e.g. after an import) are materialized lazily; entries of removed teams are retained in storage but hidden. See [`DATA_MODEL.md`](DATA_MODEL.md).
- **UI:** a team switcher appears only when the project has more than one team; capacity/board/summary sections are scoped to the selected team; the issue overlay offers a cross-team assignee picker for handoffs; the settings form keeps the flat single-team layout until "Add another team" is used.

---

## Compute-on-read metrics

There is **no metric cache**. `ApiClient.getSprint` fetches the native Sprint + its issues and the stored `SprintEntry`, then [`buildSprintView`](src/widgets/sprint-view.ts) computes every number live with the domain math ([`computeMetrics`](src/domain/metrics/metrics.ts)): per-team raw/planned capacity, effort aggregates, observed Focus Factor, per-assignee load, completion figures once the finish day has passed. Sprint totals sum team capacity but aggregate **all** issues (unassigned and outside-team work stays visible). The planner tab polls, so views stay current as issues change — nothing can go stale because nothing is stored.

---

## Optimistic concurrency

Config and each team's capacity carry monotonic revisions. Mutations send `expectedRevision`; a mismatch returns `CONFIG_REVISION_CONFLICT` / `CAPACITY_REVISION_CONFLICT` (in the 200 envelope), surfaced by `ApiClientError.isConflict` and a retry banner in the UI. Capacity revisions are **per team per Sprint**, so two teams editing the same Sprint never conflict with each other.

Revisions guard **same-team** races only: the platform offers no compare-and-set — extension-property writes are last-write-wins — so overlapping writes to *different* teams of one Sprint can silently clobber each other. The client converges that case with a verified-write loop (`writeCapacityVerified` in [`src/widgets/api-client.ts`](src/widgets/api-client.ts), also used by the focus-factor override): write, re-read the fresh document, verify the delta persisted, re-apply on top with bounded retries. See [`DATA_MODEL.md`](DATA_MODEL.md) → *Scale & concurrency*.

---

## Errors, envelope, correlation

Every backend response is an HTTP-200 envelope `{ok, data|error}` (the host's `fetchApp` does not surface HTTP error bodies reliably); failures carry a structured `ApiError` with a per-request `correlationId` and are logged as a single sanitized `console.error` line. Details and the code table: [`SECURITY.md`](SECURITY.md).

The "create next Sprint" flow lives in [`ApiClient.createNextSprint`](src/widgets/api-client.ts) and is safe to retry: an existing managed Sprint with identical dates is **resumed** (returned as-is); a name collision raises `SPRINT_ALREADY_EXISTS` before the native create.

---

## Units, time, and rounding

- **Minutes** are the internal unit for all effort/capacity (matches YouTrack period storage); days/hours conversion is presentation-only ([`src/shared/units.ts`](src/shared/units.ts)).
- **UTC everywhere:** timestamps are epoch ms; Sprint dates are `yyyy-mm-dd` on UTC midnight so DST never shifts a working-day count ([`src/domain/dates/dates.ts`](src/domain/dates/dates.ts)). The completed-effort window is inclusive of the whole finish day.
- **No premature rounding:** domain functions round only to whole minutes; the UI rounds to days at the edge.
