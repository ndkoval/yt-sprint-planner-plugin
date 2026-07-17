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

## Extension points & properties

- Widgets attach at declared extension points (project tab / project settings). SPIKE: confirm
  the exact `extensionPoint` enum values for a project tab vs. settings pane on the target version.
- Extension properties are declared in `entity-extensions.json` with primitive types
  (`boolean`, `integer`, `float`, `string`, `user`). **Primitive arrays are NOT supported** —
  store dynamic/nested structures as **versioned JSON strings** (e.g. `scpCapacityJson`), always
  with a `version` field and unknown-field preservation for migrations.

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
never authorization. Board create/edit additionally requires the caller's real Board permission
(resolved at the REST boundary), never a shared admin token in production.
