# Workflows

Six workflow modules under [`src/workflows/`](src/workflows/) run *inside* YouTrack and maintain the incremental metric cache on the `scp*` extension properties. They are plain CommonJS (ES2019); TypeScript cannot be imported into the workflow runtime, so the needed effort/focus-factor math is **mirrored** from the domain library in [`workflow-common.js`](src/workflows/workflow-common.js).

**Universal rules**

- All values are **minutes**; all timestamps are **UTC epoch ms**.
- Effort field **names are read from config** (`scpConfigJson`) — never hardcoded.
- The **native Sprint is the only source of truth** for membership.
- Handlers **never block** the user's edit: errors are caught, sanitized onto `scpWorkflowError`, and affected Sprints flagged `needs-recalculation` for reconciliation.
- Incremental updates are **snapshot-based and idempotent**: running twice produces no further change, so rules compose safely in one transaction.

---

## Event → action matrix

| Event | issue-metrics | sprint-membership | issue-removal | completed-sprint | reconciliation | availability-reminder |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Original/Current Effort changes | ✓ delta | — | — | ✓ if Sprint completed | — | — |
| Resolved ↔ unresolved / resolution time | ✓ delta | — | — | ✓ if Sprint completed | — | — |
| Sprint membership add/remove/move | ✓ delta | ✓ guard+delta | — | ✓ if completed | — | — |
| Issue created | ✓ delta | — | — | — | — | — |
| Issue deleted | — | — | ✓ subtract | — | — | — |
| Hourly cron | — | — | — | — | ✓ repair dirty | — |
| Daily cron | — | — | — | — | — | ✓ nudge unconfirmed |

`issue-metrics` and `completed-sprint` guard `true` (permissive) because the recompute is idempotent; `sprint-membership` guards on an actual membership diff.

---

## `workflow-issue-metrics.js` — `Issue.onChange`

**Trigger:** any issue change that can affect a managed Sprint's aggregate effort (Original/Current Effort, resolution state/timestamp, Sprint membership, creation, project change).

**Algorithm** (`common.recomputeIssueMetrics`):
1. Read the issue's previous snapshot (`scpMetricsSnapshotJson`).
2. Read current managed-Sprint membership.
3. Form the **union** of previous + current Sprint ids (the affected set).
4. For each affected Sprint reachable from the issue: apply the signed delta (old→new contribution) to `scpOriginalEffortMinutes` / `scpCurrentEffortMinutes` / `scpCompletedOriginalEffortMinutes` (clamped ≥ 0), bump `scpMetricsRevision`, stamp `scpLastWorkflowUpdateAt`, set status `incremental` (unless already `error`).
5. Persist a fresh issue snapshot; bump `scpWorkflowRevision`; clear `scpWorkflowError`.

**Old/new contribution:** `common.issueContribution` mirrors `aggregateEffort` — original counts for all issues, current only for unresolved, completed only for issues resolved within `[start, finish]`. The *old* contribution is computed from the previous snapshot's recorded state for that Sprint (`oldContributionFor`).

**Membership/removal handling:** a Sprint the issue **left** (in the previous snapshot but not current) cannot always be resolved from the issue's live membership, so its subtraction is **deferred to reconciliation** (the Sprint is logged and left dirty).

---

## `workflow-sprint-membership.js` — `Issue.onChange`

**Trigger:** an issue is added to / removed from / moved between Sprints (multi-Sprint membership supported).

**Detection (guard):** `membershipChanged` compares the current managed-Sprint id set to the set stored in the last snapshot; runs when they differ (or on error, conservatively runs).

**Algorithm:** delegates to `common.recomputeIssueMetrics` (union of old+new Sprint ids). Because deltas are snapshot-idempotent, whichever of this rule / issue-metrics runs second sees an already-updated snapshot and produces a zero delta.

---

## `workflow-issue-removal.js` — `Issue.onChange` (removal)

**Trigger:** an issue is **deleted** (`runOn: { change: false, removal: true }`, guard `ctx.issue.becomesRemoved === true`).

**Algorithm** (`subtractOnRemoval`): read the last snapshot; for each managed Sprint id in it that is still reachable during the removal transaction, subtract the recorded contribution (old→zero), bump the revision, stamp the update, and **mark the Sprint dirty** so reconciliation confirms the totals. Sprints whose handle can't be resolved are logged and left to reconciliation. **Never creates a replacement/service issue.**

---

## `workflow-completed-sprint.js` — `Issue.onChange`

**Trigger:** a change to resolution/effort/membership where an affected managed Sprint is already **completed** — enables post-finish corrections without reopening/finalizing the Sprint.

**Algorithm:** run `common.recomputeIssueMetrics` (keeps `scpCompletedOriginalEffortMinutes` current via deltas); for each *touched* Sprint that is completed, `common.refreshCompletionSnapshot` recomputes Observed Focus Factor (`Completed / Raw`, `null` when Raw ≤ 0) and rewrites `scpCompletionCalculationJson` + `scpCompletionCalculatedAt`, incrementing `calculationRevision`.

---

## `workflow-reconciliation.js` — `Issue.onSchedule`

**Trigger:** cron (default hourly, `0 0 * * * ?`), `search: 'has: Board'`.

**Why on an issue schedule:** `onSchedule` iterates **issues**, not Sprints, so the sweep reaches Sprints through their member issues.

**Algorithm (per matching issue):** enumerate the issue's managed Sprints; for each that is dirty *and* not yet reconciled this run: `recomputeSprintFromScratch` (absolute recompute from the Sprint's current issues, also refreshing each issue's snapshot so future deltas start correct), clears `scpMetricsDirty`, sets `up-to-date`, stamps `scpLastRecalculatedAt`; if completed, `refreshCompletionSnapshot`. Failures set status `error` and leave the Sprint dirty for next run.

**Scheduled reconciliation + dedup:** two layers — a module-level `reconciledThisRun` set, and clearing `scpMetricsDirty` so later issues in the same Sprint skip. If neither persists across per-issue invocations (see SPIKE) it degrades to "once per member issue" — correct but wasteful.

---

## `workflow-availability-reminder.js` — `Issue.onSchedule`

**Trigger:** cron (default daily 08:00, `0 0 8 * * ?`), `search: 'has: Board'`.

**Algorithm (per matching issue):** for each upcoming managed Sprint starting within `[now, now + leadDays]` (from app setting `reminderLeadDays`, default 3) not yet processed this run: parse `scpCapacityJson`; for each row with `confirmed === false`, notify the user unless reminded in the last 24h.

**Rate limit:** a per-row `scpLastReminderAt` (an *unknown* field preserved inside the capacity document) enforces at most one reminder per person per 24h; the timestamp is stamped even when delivery fails so the limit still holds. Reminders are **informational only** and never block.

---

## `// SPIKE` assumptions to verify on real YouTrack

Grepped from [`src/workflows/`](src/workflows/) (`grep -rn "SPIKE" src/workflows`):

**`workflow-common.js`**

| Line | Assumption |
| --- | --- |
| 226 | Reading Project extension property `scpConfigJson` (accessor for app-owned Project props). |
| 292 | Read app extension property via `entity.extensionProperties[name]` (fallback `entity[name]`). |
| 317 | Write app extension property via `entity.extensionProperties[name] = value`. |
| 354 | Issue → agile Sprint membership accessor (`issue.sprints` vs `issue.getSprints()`). |
| 383 | SDK Set collections expose `.forEach` and/or are iterable. |
| 410 | Sprint stable id is `sprint.id` (fallback: name). |
| 422 | Sprint native `start`/`finish` exposed as epoch-ms numbers. |
| 457 | Period custom field read via `issue.fields[fieldName]`, value exposes `.minutes`. |
| 487 | `issue.resolved` is resolution epoch ms (fallback `issue.isResolved()`). |
| 674 | No API to fetch an arbitrary Sprint by id from a rule (left Sprints deferred to reconcile). |
| 713 | Sprint → issues accessor (`sprint.issues` vs `sprint.getIssues()`). |
| 808 | Authoritative "sprint finished" signal (`finished` flag vs past finish date). |
| 858, 868, 878 | App-level settings accessor (`.../settings` module `getValue`, or a global `settings`). |
| 894, 905 | Notifications API surface + `sendEmail(recipients, subject, bodyHtml)` signature. |
| 917, 925 | User lookup by id (`entities.User.findByRingId` / `findById`). |

**`workflow-reconciliation.js`**

| Line | Assumption |
| --- | --- |
| 26, 43 | Whether module-level dedup state persists across per-issue actions of one `onSchedule` run, and whether an `scpMetricsDirty` write is visible to the next issue in the same run. |
| 82 | A search that efficiently selects issues in managed Sprints (no query term for the `scpManaged` flag; currently `has: Board` + filter). |

**`workflow-issue-removal.js`**

| Line | Assumption |
| --- | --- |
| 59 | Sprint handle may be unresolvable during removal (deferred to reconcile). |
| 76 | `runOn.removal` selects the deletion event. |
| 80 | `ctx.issue.becomesRemoved` flag name for removal. |

**`workflow-availability-reminder.js`**

| Line | Assumption |
| --- | --- |
| 38 | Module-level dedup state across a single run. |
| 125 | Search selecting board issues to reach upcoming managed Sprints. |

> **Note:** the app declares `reconciliationCron` in [`settings.json`](settings.json), but the reconciliation workflow currently hardcodes its cron (`0 0 * * * ?`); only `reminderLeadDays` is read at runtime (via `getAppSettingNumber`).
