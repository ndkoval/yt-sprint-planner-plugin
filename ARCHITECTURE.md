# Architecture

This document describes how the Sprint Capacity Planner is structured and the invariants that keep it correct. See [`README.md`](README.md) for the product overview.

---

## Native Sprint as the single source of truth

The app **never** owns a Sprint object. Every managed Sprint is a *native* YouTrack Sprint (agile iteration). Its `name`, `goal`, `start`, and `finish` live on the native Sprint and are read/written via REST ([`src/backend/repositories/youtrack-client.ts`](src/backend/repositories/youtrack-client.ts) — `createSprint`/`updateSprint`). Sprint **membership** (which issues are in a Sprint) is likewise owned by YouTrack; the app only reads it. Everything the app adds is stored in `scp*` extension properties on the Sprint / Issue / Project — see [`DATA_MODEL.md`](DATA_MODEL.md).

Consequences:

- No service issues, no shadow Sprint records, no committed-scope snapshots.
- Deleting/uninstalling the app removes only `scp*` properties; native data is untouched.

---

## Component boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│  Widgets (iframe UI)                          src/widgets/             │
│  ─ project-tab/SprintCapacityTab.tsx   ─ project-settings/SettingsForm │
│  ─ components/*  (Ring UI)                                             │
│  ─ api-client.ts  ── HostBridge (SPIKE: YTApp.register / fetchApp) ──┐ │
└───────────────────────────────────────────────────────────────────│──┘
                                                                     │ HTTP (JSON, ?projectId=…)
┌────────────────────────────────────────────────────────────────────▼─┐
│  Backend (app HTTP handler)                    src/backend/            │
│  index.ts (SDK adapter, SPIKE) → http/router.ts → app.ts (routes)     │
│  services/*  (capacity, config, sprint, focus-factor, metrics,        │
│              reconciliation, diagnostics, export-import, sprint-view)  │
│  repositories/  sprint-repository · config-repository                 │
│        │                                                              │
│        ▼   YouTrackClient  (transport boundary — the only YT seam)    │
│  repositories/youtrack-client.ts  (interface)                         │
│  repositories/youtrack-http-client.ts (REST impl, SPIKEs)             │
└───────────────────────────────────────────────────────────────────┬──┘
                                                                     │
┌──────────────────────────────────────────────┐   ┌─────────────────▼─┐
│  Pure domain library      src/domain/         │   │  YouTrack instance │
│  dates · capacity · effort · focus-factor ·   │   │  (native Sprints,  │
│  sprint/naming · permissions · migrations     │   │   issues, groups)  │
│  (imported by backend AND mirrored in JS      │   └───────────────────┘
│   by workflows)                               │             ▲
└──────────────────────────────────────────────┘             │ Workflow API
                                                              │ (extension props,
┌──────────────────────────────────────────────┐             │  membership, periods)
│  Workflows (CommonJS, run in YouTrack)         │─────────────┘
│  src/workflows/*.js  (+ workflow-common.js)    │
└──────────────────────────────────────────────┘

Shared contracts:  src/shared/  (types · schemas · api · api-schemas · units)
```

- **UI** renders and calls the backend; it holds *no* authorization logic (visibility ≠ authz).
- **Backend** owns all writes, validation, authorization, optimistic concurrency, and authoritative reconciliation.
- **Domain** is pure and side-effect-free; it is the correctness core and is unit-tested to a high bar.
- **Workflows** run *inside* YouTrack and update the cache incrementally; they re-implement the needed domain math in plain ES2019 (TypeScript cannot be imported into a workflow runtime).

---

## Units, time, and rounding

- **Minutes** are the internal unit for every effort/capacity value (matches YouTrack period storage), avoiding float drift. Days/hours conversion is presentation-only ([`src/shared/units.ts`](src/shared/units.ts)).
- **UTC** everywhere: timestamps are epoch ms; Sprint dates are `yyyy-mm-dd` computed on UTC midnight so DST/timezone never shifts a working-day count ([`src/domain/dates/dates.ts`](src/domain/dates/dates.ts)).
- **No premature rounding**: domain functions round only when producing a whole-minute result; the UI rounds to days at the edge.

---

## Extension-property storage model

App-owned data uses the `scp` prefix (`SCP_PREFIX` in [`src/shared/types.ts`](src/shared/types.ts)) and is declared in [`entity-extensions.json`](entity-extensions.json). Because the Apps SDK does **not** support primitive-array extension properties, all dynamic/nested structures (capacity rows, completion snapshot, per-issue snapshot, project config, Focus Factor override) are stored as **versioned JSON strings** (`scp*Json`), each carrying a `version` field for migration. Scalar caches (revisions, aggregate minutes, flags, timestamps) are stored as native typed properties. See [`DATA_MODEL.md`](DATA_MODEL.md).

---

## Incremental cache vs. authoritative reconciliation (§13)

Two layers keep metrics correct:

1. **Incremental (workflows).** On each relevant issue change, a workflow applies a *signed delta* (old contribution → new contribution) to the affected Sprints' aggregate minutes and marks status `incremental`. This is snapshot-based and idempotent, so multiple rules in one transaction compose safely. It is fast but can drift (missed events, unreachable Sprint handles).
2. **Authoritative (backend).** [`ReconciliationService`](src/backend/services/reconciliation-service.ts) fetches the *full current issue set*, recomputes every metric from scratch via the pure domain library, overwrites the cache, and sets status `up-to-date`. It runs after Sprint creation, after date changes, before next-Sprint creation, on the **Recalculate** button, when a dirty Sprint is opened, and on schedule.

The incremental cache is never treated as ground truth; reconciliation always wins.

---

## Optimistic concurrency

Capacity and config carry monotonic revision counters. A mutating request sends `expectedRevision`; the service compares it to the stored revision and throws a `*_REVISION_CONFLICT` (HTTP **409**) on mismatch, otherwise writes and bumps the revision:

- Capacity: [`CapacityService.applyPatch`](src/backend/services/capacity-service.ts) → `CAPACITY_REVISION_CONFLICT`.
- Config: [`ConfigService.save`](src/backend/services/config-service.ts) → `CONFIG_REVISION_CONFLICT`.

The typed client surfaces these via `ApiClientError.isConflict` ([`src/widgets/api-client.ts`](src/widgets/api-client.ts)).

---

## Idempotent next-Sprint creation (§14)

[`SprintService.createNext`](src/backend/services/sprint-service.ts) is safe to retry. Stages (mirrored by `CreateSprintStage` in [`src/shared/types.ts`](src/shared/types.ts)): reconcile previous → compute dates/sequence/name/next-factor → **duplicate guard** → create native Sprint → initialise `scp*` properties (with a `scpCreateOperationId`) → seed capacity rows → optionally move unresolved issues → reconcile the new Sprint. If a Sprint with the same `start`/`finish` already exists it **resumes** (returns it, `resumed: true`); an identical *name* collision raises `SPRINT_ALREADY_EXISTS`.

---

## Error envelope + correlation ids

Every non-2xx response is a single JSON shape (`ApiError` in [`src/shared/api.ts`](src/shared/api.ts)):

```json
{ "code": "...", "message": "...", "details": { }, "correlationId": "..." }
```

[`src/backend/errors.ts`](src/backend/errors.ts) maps each `ApiErrorCode` to an HTTP status and converts thrown values safely (Zod → `400 VALIDATION_FAILED`, unknown → `500 INTERNAL_ERROR`; **stack traces are never exposed**). The router ([`src/backend/http/router.ts`](src/backend/http/router.ts)) generates a `correlationId` per request and attaches it to both the response and sanitized logs ([`src/backend/diagnostics/logger.ts`](src/backend/diagnostics/logger.ts)).

| Code | Status |
| --- | --- |
| `VALIDATION_FAILED` | 400 |
| `FORBIDDEN`, `BOARD_PERMISSION_REQUIRED` | 403 |
| `NOT_FOUND` | 404 |
| `NOT_CONFIGURED`, `CAPACITY_REVISION_CONFLICT`, `CONFIG_REVISION_CONFLICT`, `SPRINT_ALREADY_EXISTS`, `CALIBRATION_UNAVAILABLE` | 409 |
| `INTERNAL_ERROR` | 500 |

---

## The transport boundary (`YouTrackClient`) and why it exists

[`src/backend/repositories/youtrack-client.ts`](src/backend/repositories/youtrack-client.ts) is an **interface** — the *only* place the backend talks to YouTrack. It normalises YouTrack's raw shapes into typed values (periods → minutes, dates → `yyyy-mm-dd`, resolution → epoch ms). Two implementations:

- [`youtrack-http-client.ts`](src/backend/repositories/youtrack-http-client.ts) — the real REST client (with `// SPIKE` markers where the SDK surface is unverified).
- [`tests/contract/fake-youtrack.ts`](tests/contract/fake-youtrack.ts) — an in-memory fake used by contract tests.

Why the seam exists:

- **Testability** — contract tests run *every* backend service for real against the fake; only the transport is mocked, and extension properties round-trip through a per-entity store so persistence and reconciliation are observable.
- **Contract clarity** — the interface *is* the documented dependency on YouTrack; when the SDK surface is verified, only the HTTP client changes.

The HTTP handler adapter in [`src/backend/index.ts`](src/backend/index.ts) is deliberately thin (a `// SPIKE` isolates the SDK registration shape) so all logic stays unit/contract testable through the transport-agnostic `Router`.
