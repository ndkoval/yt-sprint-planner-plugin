# Data Model

All app data lives in `scp`-prefixed extension properties declared in [`entity-extensions.json`](entity-extensions.json). Primitive arrays are **not** supported by the Apps SDK, so every dynamic/nested structure is stored as a **versioned JSON string** (`scp*Json`); scalar caches use native typed properties. Native Sprint `name`/`goal`/`start`/`finish` are **not** here — they stay on the native Sprint and are managed via REST.

Units: **minutes** for effort/capacity; **UTC epoch ms** for timestamps; **`yyyy-mm-dd`** for Sprint dates.

---

## Sprint properties

| Property | Type | Meaning |
| --- | --- | --- |
| `scpManaged` | boolean | This Sprint is managed by the app. |
| `scpSchemaVersion` | integer | Sprint-record schema version (currently 1). |
| `scpProjectId` | string | Owning project id. |
| `scpBoardId` | string | Board id. |
| `scpSequence` | integer | Monotonic Sprint sequence number. |
| `scpCreateOperationId` | string | Idempotency key for the create-next flow. |
| `scpCapacityRevision` | integer | Optimistic-concurrency revision for the capacity document. |
| `scpCapacityJson` | string (JSON) | `CapacityDocument` — per-person rows. |
| `scpFocusFactor` | float | Current Focus Factor. |
| `scpFocusFactorSource` | string | `bootstrap` \| `calculated` \| `manual` \| `carried-forward`. |
| `scpFocusFactorOverrideJson` | string (JSON) | `FocusFactorOverride` (last manual override) or unset. |
| `scpRawCapacityMinutes` | integer | Cached Raw Capacity. |
| `scpConfirmedCapacityMinutes` | integer | Cached Confirmed Capacity. |
| `scpPlannedCapacityMinutes` | integer | Cached Planned Capacity. |
| `scpOriginalEffortMinutes` | integer | Cached Original Effort. |
| `scpCurrentEffortMinutes` | integer | Cached Current Effort. |
| `scpCompletedOriginalEffortMinutes` | integer | Cached Completed Original Effort. |
| `scpObservedFocusFactor` | float | Observed Focus Factor (null-modelled as unset). |
| `scpExcludedFromCalibration` | boolean | Sprint excluded from Focus Factor calibration. |
| `scpCalibrationSkipReason` | string | Reason for exclusion. |
| `scpMetricsRevision` | integer | Metrics revision counter. |
| `scpMetricsDirty` | boolean | Cache needs authoritative reconciliation. |
| `scpDataIntegrityStatus` | string | `up-to-date` \| `incremental` \| `needs-recalculation` \| `recalculating` \| `error`. |
| `scpLastWorkflowUpdateAt` | integer | Last incremental (workflow) update. |
| `scpLastRecalculatedAt` | integer | Last authoritative reconciliation. |
| `scpLastRecalculatedBy` | user | User who triggered reconciliation. |
| `scpCompletionCalculatedAt` | integer | When the completion snapshot was computed. |
| `scpCompletionCalculationJson` | string (JSON) | `CompletionCalculation` snapshot. |

> **Implementation notes.** `scpLastRecalculatedBy` is declared but **not currently written or read** by [`SprintRepository`](src/backend/repositories/sprint-repository.ts) (`recalculatedBy` is passed to `saveMetrics` but not persisted). The workflow rate-limit stamp `scpLastReminderAt` is stored *inside* the capacity JSON as a preserved unknown field, not as a top-level property.

## Issue properties

| Property | Type | Meaning |
| --- | --- | --- |
| `scpIssueSchemaVersion` | integer | Issue-snapshot schema version. |
| `scpMetricsSnapshotJson` | string (JSON) | `IssueSnapshot` — last-known contribution for delta math. |
| `scpWorkflowRevision` | integer | Workflow update counter for this issue. |
| `scpWorkflowError` | string | Last sanitized workflow error (empty when healthy). |

## Project properties

| Property | Type | Meaning |
| --- | --- | --- |
| `scpConfigVersion` | integer | Declared config-version property. |
| `scpConfigJson` | string (JSON) | `ProjectConfig` document. |
| `scpCapacityManagers` | string | Name of the YouTrack group whose members are Capacity Managers. |
| `scpConfigRevision` | integer | Optimistic-concurrency revision for config. |

> **Implementation notes.** [`ConfigRepository`](src/backend/repositories/config-repository.ts) reads `scpConfigJson`, `scpConfigRevision`, `scpCapacityManagers`; `scpConfigVersion` is declared but unused (the config's version lives inside the JSON). No API route sets `scpCapacityManagers` yet — the repository exposes `saveManagersGroup` but nothing calls it, so the managers group is seeded out-of-band (see the host-API SPIKE in [`SettingsForm.tsx`](src/widgets/project-settings/SettingsForm.tsx)).

---

## JSON documents (zod schemas)

Defined and validated in [`src/shared/schemas.ts`](src/shared/schemas.ts); TypeScript shapes in [`src/shared/types.ts`](src/shared/types.ts). All are `.strict()` (unknown top-level keys rejected on parse). User ids match `^\d+-\d+$`.

### CapacityDocument (`scpCapacityJson`)

```json
{
  "version": 1,
  "createdFromConfigVersion": 3,
  "rows": {
    "1-42": {
      "userId": "1-42",
      "loginSnapshot": "alice",
      "displayNameSnapshot": "Alice A.",
      "defaultMinutes": 4800,
      "availableMinutes": 4320,
      "availableWasCustomized": true,
      "confirmed": true,
      "note": "1 day PTO",
      "updatedAt": 1752624000000,
      "updatedBy": "1-42"
    }
  }
}
```

Minutes are non-negative integers; everyone is planned at 100% (no per-person allocation). `availableWasCustomized` blocks auto-reset when Sprint dates change.

### CompletionCalculation (`scpCompletionCalculationJson`)

```json
{
  "version": 1,
  "calculatedAt": 1753142399999,
  "sprintStart": 1751932800000,
  "sprintFinish": 1753142400000,
  "rawCapacityMinutes": 9600,
  "originalEffortMinutes": 7200,
  "completedOriginalEffortMinutes": 6240,
  "observedFocusFactor": 0.65,
  "calculationRevision": 2
}
```

`observedFocusFactor` is `>= 0` or `null` (null when Raw Capacity is 0).

### IssueSnapshot (`scpMetricsSnapshotJson`)

```json
{
  "version": 1,
  "managedSprintIds": ["143-7"],
  "originalEffortMinutes": 480,
  "currentEffortMinutes": 240,
  "resolved": false,
  "resolvedAt": null,
  "updatedAt": 1752624000000
}
```

Used by workflows for signed-delta math; `managedSprintIds` records where the issue was so a departure can be reconciled.

### ProjectConfig (`scpConfigJson`)

```json
{
  "version": 1,
  "boardId": "116-3",
  "originalEffortField": "Original estimation",
  "currentEffortField": "Estimation",
  "hoursPerDay": 8,
  "sprintLengthDays": 14,
  "firstSprintStart": "2026-01-05",
  "datePolicy": "continuous",
  "nameTemplate": "AppGlass {year}-S{sequence}",
  "bootstrapFocusFactor": 0.7,
  "learningRate": 0.2,
  "maxFactorStep": 0.05,
  "minFocusFactor": 0.3,
  "maxFocusFactor": 0.9,
  "participants": [
    { "userId": "1-42", "enabled": true, "note": "Lead" },
    { "userId": "1-43", "enabled": true }
  ]
}
```

Constraints (schema): all Focus Factor bounds in `(0,1]`; `minFocusFactor` < `maxFocusFactor`; `firstSprintStart` is `yyyy-mm-dd`; effort field names non-empty. `nameTemplate` placeholders are `{year}` `{sequence}` `{startDate}` `{finishDate}`.

### FocusFactorOverride (`scpFocusFactorOverrideJson`)

```json
{
  "reason": "One-off spike sprint",
  "oldValue": 0.73,
  "newValue": 0.6,
  "userId": "1-1",
  "timestamp": 1752624000000
}
```

`newValue` ∈ [0,1]; `reason` required.

---

## Schema versions & migration framework

Every persisted JSON document carries a `version`. Current versions ([`src/domain/migrations/registry.ts`](src/domain/migrations/registry.ts)):

| Document | Constant | Value |
| --- | --- | --- |
| Capacity | `CURRENT_CAPACITY_VERSION` | 1 |
| Completion | `CURRENT_COMPLETION_VERSION` | 1 |
| Issue snapshot | `CURRENT_ISSUE_SNAPSHOT_VERSION` | 1 |
| Config | `CURRENT_CONFIG_VERSION` | 1 |

The framework ([`src/domain/migrations/migrations.ts`](src/domain/migrations/migrations.ts)) runs an ordered chain of `Migration { fromVersion, up }` steps. Migrations are:

- **sequential** — `v_n → v_{n+1}`, never skipping (a missing step throws);
- **idempotent** — an already-current document is a no-op;
- **fail-safe** — unknown fields are preserved; a step that produces the wrong version aborts the chain; downgrades are refused;
- **pure** — returns a new object, never mutates input.

The **backup-before-write** step (take a copy before persisting the migrated result) is an I/O concern handled at the repository layer, not in the pure framework. Because v1 is the first shipped schema, all four registry lists are currently **empty**; new versions add one step each and bump the constant. Workflows enforce the same version guard on read (`parseVersionedJson` refuses a newer-than-supported document and preserves unknown fields via `mergePreserving`).

---

## Audit fields

| Field | Where | Records |
| --- | --- | --- |
| `updatedAt` / `updatedBy` | capacity row | last edit to that row (ms + user id) |
| `scpLastWorkflowUpdateAt` | Sprint | last incremental workflow update |
| `scpLastRecalculatedAt` | Sprint | last authoritative reconciliation |
| `scpMetricsRevision` / `scpCapacityRevision` / `scpConfigRevision` | Sprint / Project | monotonic revision counters |
| `scpWorkflowRevision` / `scpWorkflowError` | Issue | workflow update count + last sanitized error |
| `FocusFactorOverride.{userId,timestamp,reason,oldValue,newValue}` | Sprint | who overrode the Focus Factor, when, and why |
| `CompletionCalculation.{calculatedAt,calculationRevision}` | Sprint | completion snapshot provenance |

---

## Export / import bundle

Shape from [`src/backend/services/export-import-service.ts`](src/backend/services/export-import-service.ts) (`EXPORT_VERSION = 1`, validated with `.strict()`):

```json
{
  "exportVersion": 1,
  "exportedAt": 1752624000000,
  "projectId": "0-5",
  "config": { "...ProjectConfig or null" },
  "configRevision": 3,
  "sprints": [
    {
      "id": "143-7",
      "name": "AppGlass 2026-S3",
      "start": "2026-02-02",
      "finish": "2026-02-15",
      "sequence": 3,
      "focusFactor": 0.73,
      "focusFactorSource": "calculated",
      "rawCapacityMinutes": 9600,
      "originalEffortMinutes": 7200,
      "currentEffortMinutes": 1200,
      "completedOriginalEffortMinutes": 6240,
      "observedFocusFactor": 0.65,
      "excludedFromCalibration": false,
      "capacity": { "...CapacityDocument or null" },
      "completion": { "...CompletionCalculation or null" }
    }
  ]
}
```

**Import semantics:** the bundle is schema-validated; `?dryRun=true` returns a conflict report without writing. On apply, config is saved (revision bumped) and per-Sprint capacity is written **only for Sprints that already exist by id** in the project. Bundle Sprints with no matching native Sprint are reported as conflicts and **not created** — the app never fabricates native Sprints on import.
