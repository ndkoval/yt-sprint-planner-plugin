# Sprint Capacity Planner

A YouTrack App that adds **capacity planning, computed delivery metrics, and a one-click "create next Sprint" button** on top of *native* YouTrack Sprints. The native Sprint stays the single source of truth for membership; this app only layers planning data and calculations over it.

- **Package name:** `sprint-capacity-planner`
- **Version:** `0.1.0`
- **Vendor:** AppGlass
- **Scopes:** `Agile.Read`, `Agile.Update`, `Issue.Read`, `Project.Read` (see [`manifest.json`](manifest.json))

> **Status:** the domain, backend, workflows, widgets, build/pack, and test harnesses are implemented. A number of YouTrack SDK integration points are still marked `// SPIKE` and must be verified against a real instance before production use — see [Known SPIKEs](#known-spikes) and [`CHANGELOG.md`](CHANGELOG.md).

---

## What it adds

| Capability | Notes |
| --- | --- |
| Per-person capacity planning per Sprint | Working-days × hours (everyone at 100%), with per-row available/confirmed/note overrides |
| Computed capacity metrics | Default, Raw, Confirmed, Planned capacity |
| Computed effort metrics | Original, Current, Completed Original effort, plus missing-effort warnings |
| Learned Focus Factor | Observed factor per completed Sprint; auto-calibrated next factor with bounds |
| One-click next Sprint | Idempotent create-next flow with computed dates, name, sequence, seeded capacity |
| Manager diagnostics + export/import | Data-health view and a versioned JSON backup bundle |

## What it deliberately omits

This app intentionally does **not**:

- create **service / placeholder issues** for capacity or corrections;
- track **committed scope or committed effort** (only *original/current/completed* are computed from live issues);
- provide **locks / unlock**, **manual finalize**, or an **approval gate** on Sprints;
- track **spent time** or **work items**.

Availability confirmation and reminders are **informational only** and never block anything.

---

## Supported YouTrack

- **Minimum version:** `2024.3` (`minYouTrackVersion` in [`manifest.json`](manifest.json)).
- **Cloud & Server:** the app is a standard packaged YouTrack App and targets both. The **real-instance test harness** ([`scripts/`](scripts/)) only stands up a *local, disposable* Server instance and hard-blocks Cloud/production URLs — it is for testing, not deployment.

---

## Installation

Requires Node.js **≥ 20**.

```bash
npm ci
npm run build      # -> dist/  (backend, widgets, workflows, manifest, entity-extensions, settings)
npm run pack       # -> dist/sprint-capacity-planner.zip
```

Then, in YouTrack:

1. Install the ZIP at **Administration → Apps → Import app** (upload `dist/sprint-capacity-planner.zip`).
2. **Attach the app to a project** whose Sprints you want to plan.
3. Open the project's **Sprint Capacity Settings** and configure it (below).

`npm run build` runs `clean → build-backend → build-widgets → copy manifest/entity-extensions/settings/workflows/assets` (see [`scripts/build.mjs`](scripts/build.mjs)). `npm run pack` zips `dist/` with a pure-Node writer (see [`scripts/pack.mjs`](scripts/pack.mjs)).

---

## Configuration

Per-project configuration is edited in the **Sprint Capacity Settings** widget and persisted as JSON in the Project extension property `scpConfigJson` (see [`DATA_MODEL.md`](DATA_MODEL.md)). The validated shape is `ProjectConfig` in [`src/shared/types.ts`](src/shared/types.ts) / [`src/shared/schemas.ts`](src/shared/schemas.ts).

| Setting | Field | Meaning |
| --- | --- | --- |
| Board | `boardId` | The sprint-based agile board to manage. Validated against live YouTrack. |
| Original Effort field | `originalEffortField` | Name of a **period** custom field attached to the project. |
| Current Effort field | `currentEffortField` | Name of a **period** custom field attached to the project. |
| Hours per day | `hoursPerDay` | Hours in one "capacity day" (default 8). |
| Sprint length | `sprintLengthDays` | Calendar-day length of a Sprint. |
| First Sprint start | `firstSprintStart` | `yyyy-mm-dd` start of the first Sprint. |
| Date policy | `datePolicy` | `continuous` (next Sprint starts the day after the previous finishes). |
| Name template | `nameTemplate` | Placeholders: `{year}` `{sequence}` `{startDate}` `{finishDate}` (see [naming](src/domain/sprint/naming.ts)). |
| Focus Factor tuning | `bootstrapFocusFactor`, `learningRate`, `maxFactorStep`, `minFocusFactor`, `maxFocusFactor` | Calibration bounds (all in `(0,1]`; `min < max`). |
| Team | `participants[]` | `{ userId, enabled, note? }` (everyone is planned at 100%). |

App-level settings (administrator scope, in [`settings.json`](settings.json)):

| Key | Default | Meaning |
| --- | --- | --- |
| `reminderLeadDays` | `3` | Days before Sprint start to nudge unconfirmed participants. |
| `reconciliationCron` | `0 0 * * * ?` | Quartz cron for scheduled reconciliation. |

**Capacity Managers** are the members of the YouTrack group named in the Project property `scpCapacityManagers`. Managers get full config, override, calibration, recalculate, diagnostics, and create/edit-Sprint powers; everyone else can edit only their own capacity row. (See [Known SPIKEs](#known-spikes) — wiring the managers group from the UI is not yet complete.)

---

## The formulas

All internal effort/capacity values are **minutes**; rounding to days/hours happens only at the UI boundary ([`src/shared/units.ts`](src/shared/units.ts)). All timestamps are UTC epoch ms. Sprint dates are calendar days computed on UTC midnight ([`src/domain/dates/dates.ts`](src/domain/dates/dates.ts)).

### Capacity ([`src/domain/capacity/capacity.ts`](src/domain/capacity/capacity.ts))

| Metric | Formula |
| --- | --- |
| **Default Capacity** (per person) | `round(workingDays × hoursPerDay × 60)` — everyone is planned at 100% (working days = Mon–Fri inclusive) |
| **Raw Capacity** | `Σ availableMinutes` over all participant rows |
| **Confirmed Capacity** | `Σ availableMinutes` over confirmed rows (informational) |
| **Planned Capacity** | `round(Raw Capacity × Focus Factor)` |
| **Remaining Capacity** | `Planned Capacity − Current Effort` (updates automatically as issues change) |

### Effort ([`src/domain/effort/effort.ts`](src/domain/effort/effort.ts))

Over the issues currently in the native Sprint:

| Metric | Rule |
| --- | --- |
| **Original Effort** | `Σ Original Effort` of all issues (missing → 0, added to a warning list) |
| **Current Effort** | `Σ Current Effort` of **unresolved** issues (resolved contribute 0; missing → 0) |
| **Completed Original Effort** | `Σ Original Effort` of issues **resolved within `[start, finish]`** |

A negative period value is rejected as a validation error.

### Focus Factor ([`src/domain/focus-factor/focus-factor.ts`](src/domain/focus-factor/focus-factor.ts))

- **Observed Focus Factor** (completed Sprint): `Completed Original Effort / Raw Capacity`, or `null` when Raw Capacity ≤ 0.
- **Next Focus Factor** for a new Sprint, from the previous eligible Sprint (`P` = previous factor, `O` = observed, `α` = `learningRate`, `M` = `maxFactorStep`, bounds `min`/`max`):

  ```
  boundedObservation = clamp(O, min, max)
  adjustment         = clamp(α × (boundedObservation − P), −M, +M)
  nextFactor         = clamp(P + adjustment, min, max)
  ```

  The first Sprint uses `bootstrapFocusFactor`. When the previous Sprint is ineligible (Raw Capacity 0, Original Effort 0, excluded, corrupt, or not reconciled) the factor is **carried forward** unchanged (still clamped).

  **Worked example** `P=0.75, O=0.65, α=0.20, M=0.03`:
  `adjustment = clamp(0.20 × (0.65 − 0.75), −0.03, +0.03) = clamp(−0.02, …) = −0.02` → `nextFactor = clamp(0.75 − 0.02) = 0.73`.

---

## Permissions

Enforced **server-side on every mutation** ([`src/domain/permissions/permissions.ts`](src/domain/permissions/permissions.ts), enforced in [`src/backend/app.ts`](src/backend/app.ts)). Frontend visibility is never authorization.

| Action | Member | Manager | Extra requirement |
| --- | --- | --- | --- |
| Read Sprint / capacity / metrics | ✓ | ✓ | any authenticated user |
| Edit **own** capacity row / confirm | ✓ | ✓ | — |
| Edit **any** capacity row | ✗ | ✓ | — |
| Edit settings, override Focus Factor, change calibration, recalculate, import/export, diagnostics | ✗ | ✓ | — |
| Create / edit native Sprint | ✗ | ✓ | **real Board permission** (`canManageBoard`) |

See [`SECURITY.md`](SECURITY.md) for the full matrix and logging policy.

---

## Workflows

Six workflow modules ([`src/workflows/`](src/workflows/)) keep the incremental cache fresh; the backend reconciliation is the authoritative source. Summary — full detail in [`WORKFLOWS.md`](WORKFLOWS.md):

| Module | Trigger | Purpose |
| --- | --- | --- |
| `workflow-issue-metrics.js` | `Issue.onChange` | Recompute effort deltas on any relevant issue change |
| `workflow-sprint-membership.js` | `Issue.onChange` | Recompute when Sprint membership changes |
| `workflow-issue-removal.js` | `Issue.onChange` (removal) | Subtract a deleted issue's contribution |
| `workflow-completed-sprint.js` | `Issue.onChange` | Correct a completed Sprint's completion metrics |
| `workflow-reconciliation.js` | `Issue.onSchedule` (hourly) | Full-from-scratch repair of dirty Sprints |
| `workflow-availability-reminder.js` | `Issue.onSchedule` (daily) | Rate-limited availability nudges |

---

## Backup / export & uninstall warning

Managers can export a versioned JSON bundle (`GET /export`) and re-import it (`POST /import`, with `?dryRun=true`). Import updates config + capacity for **existing** Sprints only and never creates duplicate native Sprints (see [`src/backend/services/export-import-service.ts`](src/backend/services/export-import-service.ts) and [`DATA_MODEL.md`](DATA_MODEL.md)).

> **Data-loss warning:** all app data lives in `scp*` extension properties on Sprints/Issues/Project. **Uninstalling the app removes these properties**, permanently deleting capacity documents, computed metrics, Focus Factor history, and completion snapshots. The **native** Sprints, issues, and their fields are untouched. **Export a backup bundle before uninstalling.**

---

## Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| `NOT_CONFIGURED` (409) | Project has no valid `scpConfigJson`; configure via the settings widget. |
| `FORBIDDEN` (403) | Non-manager attempting a manager-only action. |
| `BOARD_PERMISSION_REQUIRED` (403) | Caller lacks the real Board permission to create/edit the Sprint. |
| `CAPACITY_REVISION_CONFLICT` / `CONFIG_REVISION_CONFLICT` (409) | Someone else changed it first; reload and retry (optimistic concurrency). |
| `SPRINT_ALREADY_EXISTS` (409) | A Sprint with the computed name already exists. |
| Sprint shows `needs-recalculation` / `error` | Open it (triggers reconcile), press **Recalculate**, or wait for the scheduled sweep. Managers can inspect `GET /diagnostics`. |
| Metrics look stale in the UI | Incremental workflow cache; authoritative values come from reconciliation (§13). |

---

## Tests

See [`TESTING.md`](TESTING.md) for the full pyramid. Commands (from [`package.json`](package.json)):

| Command | What it runs | Needs a real instance? |
| --- | --- | --- |
| `npm run test:unit` | Domain unit tests (`tests/unit`) | no |
| `npm run test:contract` | Backend contract tests against the fake transport (`tests/contract`) | no |
| `npm run coverage` | Unit + contract with V8 coverage | no |
| `npm run test:integration:real` | Provision → seed → run `tests/real-youtrack` → cleanup | **yes** (local, gated) |
| `npm run test:e2e` | Playwright suite (`tests/e2e`) | **yes** (self-skips otherwise) |
| `npm run test:e2e:analyze` | Video/trace integrity + contact sheets + `artifacts/ui-analysis.md` | no (analyses artifacts) |
| `npm run test:all` | lint → typecheck:all → unit → contract → build | no |

---

## Artifact locations

| Artifact | Path |
| --- | --- |
| App package (ZIP) | `dist/sprint-capacity-planner.zip` |
| Coverage report | `artifacts/coverage/` |
| Playwright HTML + JSON report | `artifacts/playwright-report/` |
| Test results (videos/traces/screenshots) | `artifacts/test-results/` |
| Contact sheets | `artifacts/contact-sheets/` |
| UI analysis | `artifacts/ui-analysis.md` |
| Video integrity | `tests/video-analysis/video-integrity.json` |
| Test-environment manifest / cleanup report | `artifacts/test-environment-manifest.json`, `artifacts/orphan-cleanup-report.json` |
| CI browsable index | `artifacts/index.html` |

---

## Known SPIKEs

These need real-YouTrack verification before production (grep `// SPIKE` under `src/`; see [`CHANGELOG.md`](CHANGELOG.md) → *Unreleased*):

- **Extension-property read/write wiring** — [`src/backend/repositories/youtrack-http-client.ts`](src/backend/repositories/youtrack-http-client.ts) `getExtensionProperties`/`setExtensionProperties` are stubs (reads return `null`, writes no-op), so the *real* backend does not yet persist. Workflow SDK access in [`src/workflows/workflow-common.js`](src/workflows/workflow-common.js) is likewise assumed.
- **Board-permission check** — `canManageBoard` currently returns "board is readable"; the real permission query is unverified.
- **Host bridge** — the widget↔host API (`YTApp.register`, `fetchApp`, project/user id, base path) in [`src/widgets/api-client.ts`](src/widgets/api-client.ts).
- **YouTrack distribution URL** — pinned build/URL/launch flags in [`scripts/provision-real-youtrack.mjs`](scripts/provision-real-youtrack.mjs).
- **Real E2E selectors** — the Playwright specs use placeholder selectors pending a live UI.

---

See also: [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`WORKFLOWS.md`](WORKFLOWS.md) · [`DATA_MODEL.md`](DATA_MODEL.md) · [`TESTING.md`](TESTING.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)
