---
name: youtrack-app-development
description: Confirmed rules for building this YouTrack App — structure, extension points, REST vs Workflow API limits, Ring UI, packaging, migrations. Read before touching manifest/backend/workflow/widget SDK boundaries.
---

# YouTrack App development (Sprint Capacity Planner)

Confirmed, project-specific conventions. Anything marked **SPIKE** must be verified against
the current Apps SDK on a real instance (via the `context7` plugin) before relying on it.

## App structure

An installable app is a single ZIP built from `dist/` containing:
- `manifest.json` — app metadata, `widgets[]` (extension points), `backend.entryPoint`, `scopes`.
- `entity-extensions.json` — app-owned custom properties (prefix `scp`) on `Sprint`, `Issue`, `Project`.
- `settings.json` — admin-level app settings.
- `backend/index.js` — bundled HTTP handler.
- widget bundles under `widgets/<key>/index.{js,html}`.
- workflow `.js` modules (on-change / on-schedule rules).

Build: `npm run build` → `dist/`; package: `npm run pack` → `dist/sprint-capacity-planner.zip`.

## Extension points & properties (verified live on 2025.3)

- `PROJECT_TAB` **does not exist** on 2025.3 — the import rejects it ("declared incorrectly")
  and it is absent from the official extension-points reference, despite appearing in the
  schemastore JSON schema. Working placements: `PROJECT_SETTINGS` (project sidebar item),
  `MAIN_MENU_ITEM` (global sidebar; NO project context — the widget needs its own picker),
  `ISSUE_OPTIONS_MENU_ITEM`, `DASHBOARD_WIDGET`.
- **Widget names must be unique within the app.** YouTrack resolves the settings-tab URL as
  `?tab=<appName>%3A<WIDGET NAME>`; two widgets with the same name silently break that tab
  (it falls back to default project panels).
- PROJECT_SETTINGS widgets are served to regular members too (visibility is not admin-gated);
  a member seeing "Unable to load" usually means a 403 on a RESOURCE the widget fetches —
  most often the agile board: **REST-created boards default to owner-only sharing.** Create
  them with `readSharingSettings`/`updateSharingSettings` `{ projectBased: true }`.
- The host shows a one-time per-user consent prompt when an app widget issues a **DELETE**
  over `fetchYouTrack` (e.g. removing an issue from a sprint): "Allow once / Allow and don't
  ask again / Deny". The request is HELD until answered — automation must click it (a clean
  app reinstall resets the grant).
- Extension properties are declared in `entity-extensions.json` with primitive types
  (`boolean`, `integer`, `float`, `string`, `user`). **Primitive arrays are NOT supported** —
  store dynamic/nested structures as **versioned JSON strings** (e.g. `scpConfigJson`), always
  with a `version` field and unknown-field preservation for migrations.
- Extension-property writes are **last-write-wins**: two overlapping backend requests
  read-modify-write the whole document and neither aborts (verified: concurrent writes to two
  teams lost one update 5/5). There is no compare-and-set — converge from the CLIENT by
  write → re-read (new request) → verify → re-apply (see `ApiClient.writeCapacityVerified`).
  Size is not a practical limit (a 1.13 MB property round-trips in ~0.5 s).

## REST vs Workflow API — the critical split

- The native **Sprint** is the only Sprint object and the sole source of truth for issue
  membership. Never create service/anchor issues.
- Sprint `name`, `start`, `finish` are **read-only in the Workflow API** → create/modify native
  Sprints via **REST** (`/api/agiles/{board}/sprints`). Dates cross the boundary as epoch-ms;
  the app's internal calendar unit is `yyyy-mm-dd` at UTC midnight.
- Workflow rules **can** read/write the app's `scp*` extension properties and check issue↔Sprint
  membership; use them for incremental metric updates, not as the source of truth.
- Effort/period fields are stored in **minutes** by YouTrack — keep minutes as the internal unit
  everywhere; round to days only for display.

## Configurable field names

Original/Current Effort field **names are configurable** (Current may be "Remaining Effort").
Never hardcode field names — read them from the project config (`scpConfigJson`).

## Ring UI

Use `@jetbrains/ring-ui-built` components so the UI reads as native YouTrack. Match standard
spacing/typography; no custom marketing styling. Associate labels with inputs, keep keyboard
navigation and visible focus, Escape closes dialogs.

## Migrations & uninstall

- Every persisted JSON document is versioned; migrate with the sequential, idempotent framework
  in `src/domain/migrations`. Preserve unknown fields; back up before writing.
- Uninstalling the app or renaming/removing a property deletes its data → **export** support is
  mandatory. Never rely on process memory or `localStorage` as persistent state.

## Authorization

All mutations are authorised **server-side** (`src/domain/permissions`). Frontend visibility is
never authorization. The app defines NO permission scheme of its own: a "manager" is the
project leader or any holder of YouTrack's `UPDATE_PROJECT` permission on the project, checked
in the HTTP handler via `ctx.currentUser.hasPermission('UPDATE_PROJECT', projectEntity)`
(verified working on 2025.3). Board create/edit additionally requires the caller's real Board
permission (resolved at the REST boundary), never a shared admin token in production.

## Hub REST (provisioning — the "not exposed over REST" notes were wrong)

- Project TEAM membership: `POST /hub/api/rest/projectteams/{teamId}/users {id: <hubUserId>}`
  (team id from `/hub/api/rest/projects?query=<name>&fields=id,name,team(id)`).
- Role grants (e.g. a non-leader project admin): `POST /hub/api/rest/users/{id}/projectroles
  {role: {key: 'project-admin'}, project: {id: <hubProjectId>}}`.
- A Hub-created user CANNOT log in until it has a `LoginuserdetailsJSON` credentials detail:
  `POST /hub/api/rest/users/{id}` with `{details: [{type: 'LoginuserdetailsJSON', authModule:
  {id: <core module id>}, login, password: {type: 'PlainpasswordJSON', value: ...}}]}` —
  `POST /hub/api/rest/users {password}` alone silently creates a credential-less user.
  See `scripts/lib/seed-lib.mjs` for all three.
