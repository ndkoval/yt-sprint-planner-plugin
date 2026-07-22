# Data Model

All app state lives in **three project-scoped extension properties** plus one tiny **per-User** preference property, all with the `scp` prefix (`SCP_PREFIX` in [`src/shared/types.ts`](src/shared/types.ts)), declared in [`entity-extensions.json`](entity-extensions.json). Each project property is a **versioned JSON string**; there are no Sprint- or Issue-level properties, and no cached metrics — every metric is computed live on read from the current issue set ([`src/domain/metrics/metrics.ts`](src/domain/metrics/metrics.ts), [`src/widgets/sprint-view.ts`](src/widgets/sprint-view.ts)).

Native Sprint `name`/`goal`/`start`/`finish` and Sprint **membership** are *not* here — they stay on the native Sprint and are read/written through the current user's REST session ([`src/widgets/youtrack-client.ts`](src/widgets/youtrack-client.ts)). The app stores only snapshots of name/dates, refreshed on every `sprint-register`.

**Units:** minutes for all effort/capacity values; UTC epoch ms for timestamps; `yyyy-mm-dd` for Sprint dates ([`src/shared/units.ts`](src/shared/units.ts)). **Identity:** users are keyed by their YouTrack **login** everywhere (capacity rows, participants, audit fields) — the one identity available identically to the widget (`YTApp.me.login`), the backend (`ctx.currentUser.login`), workflows (`entities.User.findByLogin`) and REST.

| Property | Entity | Document | Written by |
| --- | --- | --- | --- |
| `scpConfigJson` | Project | `ConfigDocument` (v4) | backend `POST config` / `POST import` |
| `scpSprintDataJson` | Project | `SprintDataDocument` (v4) | backend Sprint/capacity/focus-factor/calibration/import handlers |
| `scpReminderStateJson` | Project | reminder stamp (v1) | the availability-reminder **workflow only** |
| `scpPrefsJson` | **User** | `UserPrefs` (unversioned) | backend `GET/POST prefs` (self-scoped, project-independent) |

TypeScript shapes: [`src/shared/types.ts`](src/shared/types.ts). Runtime validation: [`src/shared/schemas.ts`](src/shared/schemas.ts) (zod, all `.strict()` — unknown keys are rejected on parse; a compile-time `AssignableTo` check fails the build if schema and type drift). Load/save: [`src/backend/storage.ts`](src/backend/storage.ts).

---

## `scpConfigJson` — ConfigDocument (v4)

Since v4 the project level holds **only the team list** — every planning setting (board, effort fields, cadence, naming, backlog, learning rate, reminder lead) belongs to a `Team`, so different teams of one project can plan on different boards with different cadences:

```json
{
  "version": 4,
  "revision": 4,
  "config": {
    "version": 4,
    "teams": [
      {
        "id": "team-1",
        "name": "Platform",
        "participants": [
          { "userId": "alice", "enabled": true, "allocation": 1, "note": "Lead" },
          { "userId": "bob", "enabled": true, "allocation": 0.5 }
        ],
        "boardId": "116-3",
        "originalEffortField": "Original Effort",
        "currentEffortField": "Current Effort",
        "hoursPerDay": 8,
        "sprintLengthDays": 14,
        "datePolicy": "continuous",
        "nameTemplate": "Platform {year}-S{sequence}",
        "backlogQuery": "project: AGP State: Open Priority: Normal",
        "learningRate": 0.2
      },
      {
        "id": "team-2",
        "name": "Mobile",
        "participants": [
          { "userId": "charlie", "enabled": true, "allocation": 1 }
        ],
        "boardId": "116-4",
        "originalEffortField": "Original Effort",
        "currentEffortField": "Current Effort",
        "hoursPerDay": 8,
        "sprintLengthDays": 7,
        "datePolicy": "continuous",
        "nameTemplate": "Mobile {year}-S{sequence}",
        "backlogQuery": "project: AGP State: Open Priority: Major",
        "learningRate": 0.3,
        "reminderLeadDays": 5
      }
    ]
  }
}
```

`revision` is the optimistic-concurrency counter for the whole config (`POST config` sends `expectedRevision`; mismatch → `CONFIG_REVISION_CONFLICT`).

### Constraints (from `projectConfigSchema` / `teamSchema`)

Config level:

| Field | Rule |
| --- | --- |
| `teams` | **1..20** (`MAX_TEAMS`); team `id` non-empty and unique; team `name` non-empty and unique per project (case-insensitive, trimmed); a login unique **within** a team (but may appear in several teams) |

Per team:

| Field | Rule |
| --- | --- |
| `boardId`, `originalEffortField`, `currentEffortField` | non-empty strings; teams may share a board or use their own |
| `hoursPerDay` | > 0 |
| `sprintLengthDays` | positive integer |
| `datePolicy` | literal `"continuous"` (next Sprint starts the day after the previous finish) |
| `nameTemplate` | non-empty; placeholders `{year}` `{sequence}` `{startDate}` `{finishDate}` ([`src/domain/sprint/naming.ts`](src/domain/sprint/naming.ts)) |
| `backlogQuery` | any string, defaults to `""`; empty disables the team's backlog lane. The settings form defaults new teams to `project: <KEY> #Unresolved` |
| `learningRate` | in `(0, 1]` (each team calibrates from its own history) |
| `reminderLeadDays` | optional integer 0..30; **0 disables reminders for this team**; absent = use the app-level setting ([`settings.json`](settings.json), default 3) |
| `sprintFieldName` | optional string — name of a single-**enum** custom field mirroring Sprint membership for teams that also track Sprints in a field. When set, the WIDGET keeps it in sync on every planning move (into the Sprint → field = the Sprint's name, ensured as a bundle value first; back to the backlog → cleared **only when the move actually removed the issue from this Sprint**; carry-over → rewritten to the new Sprint; renaming a Sprint in the app's details editor re-stamps every issue already in it). Best-effort native-side sync via the current user's REST session — never blocks the planning move itself. **Limitations:** the mirror is single-valued — an issue sitting on several Sprints (multi-sprint boards, or two teams pointing the same field name at different boards) carries only the value of the LAST planning move; the field should allow an empty value (clearing a required field fails silently); renames done in the native board UI (outside the app) are not re-stamped. Absent/empty = off |

There is deliberately **no permission field**: managers are the project leader plus whoever holds YouTrack's own `UPDATE_PROJECT` permission on the project, checked server-side per request (see [`SECURITY.md`](SECURITY.md)); managers manage **all** teams.

### Teams

A `Team` is a small group planning independently *within* the project. Since v4 the team owns its **entire** planning configuration — nothing is shared between teams except the project itself: each team has its own board, Sprint cadence and naming, effort fields, backlog query, participants, capacity, Focus Factor calibration and reminder lead. Team `id`s (`team-1`, `team-2`, …, generated by `newTeamId` in [`src/domain/teams/teams.ts`](src/domain/teams/teams.ts)) are stable and never renamed.

**The same person may belong to several teams** (a shared specialist): they get an independent capacity row — and allocation — in each team. Issue → team attribution derives from the issue's single-value Assignee being a team *member* (enabled or not; enablement only controls capacity seeding), so a shared member's assigned issues count toward **every** team whose Sprint contains them — while each Sprint view still counts each of its issues exactly once. Within one team a login is unique (enforced by the config schema's `superRefine`); `teamsOfUser` in [`src/domain/teams/teams.ts`](src/domain/teams/teams.ts) returns all of a login's teams.

`Participant`: `userId` (login), `enabled` (seeds a capacity row when true), `allocation` in `(0, 1]` (default 1; scales the person's default capacity), optional `note`.

`Team.backlogQuery` is the query the team's board actually uses — there is no project-level fallback anymore (`effectiveBacklogQuery(team)` in [`src/domain/teams/teams.ts`](src/domain/teams/teams.ts) just trims it; empty disables the lane).

---

## `scpSprintDataJson` — SprintDataDocument (v4)

Every team's managed-Sprint state, keyed **team-first**: `teams[Team.id].sprints[nativeSprintId]`. A Sprint is managed **per team** — each team registers the Sprints on its own board, with its own sequence numbering:

```json
{
  "version": 4,
  "teams": {
    "team-1": {
      "sprints": {
        "143-7": {
          "sequence": 3,
          "name": "Platform 2026-S3",
          "start": "2026-07-06",
          "finish": "2026-07-19",
          "capacityRevision": 5,
          "capacity": {
            "version": 2,
            "createdFromConfigVersion": 3,
            "rows": {
              "alice": {
                "userId": "alice",
                "displayNameSnapshot": "Alice Smith",
                "defaultMinutes": 4800,
                "availableMinutes": 4320,
                "availableWasCustomized": true,
                "note": "1 day PTO",
                "updatedAt": 1752624000000,
                "updatedBy": "alice"
              }
            }
          },
          "focusFactor": 0.73,
          "focusFactorSource": "calculated",
          "focusFactorOverride": null,
          "excludedFromCalibration": false,
          "calibrationSkipReason": null,
          "createdAt": 1751932800000,
          "updatedAt": 1752624000000
        }
      }
    }
  }
}
```

### TeamSprint — one team's planning state for one of its Sprints

| Field | Rule |
| --- | --- |
| `sequence` | App sequence number, 1-based, monotonic **per team** (`nextSequence`) |
| `name`, `start`, `finish` | **Snapshots** of the native Sprint (`yyyy-mm-dd`), refreshed on every `sprint-register`; the native Sprint stays the source of truth |
| `capacityRevision` | optimistic-concurrency counter for this team's capacity document (per team per Sprint) |
| `capacity` | `CapacityDocument` **v2** (unchanged by the v3/v4 migrations): `createdFromConfigVersion` + `rows` keyed by login |
| `focusFactor` | in `[0, 1]` |
| `focusFactorSource` | `bootstrap` \| `calculated` \| `manual` \| `carried-forward` |
| `focusFactorOverride` | `FocusFactorOverride` (`reason` non-empty, `newValue` in `[0,1]`, `userId`, `timestamp`) or `null` |
| `excludedFromCalibration` / `calibrationSkipReason` | manager exclusion flag + reason (`null` when included) |
| `createdAt`, `updatedAt` | UTC ms audit stamps |

`CapacityRow`: `defaultMinutes` = working days × the team's `hoursPerDay` × 60 × allocation (rounded); `availableMinutes` defaults to it; `availableWasCustomized` flips on any explicit edit and blocks auto-reset when Sprint dates change (`reapplyDefaults` in [`src/domain/capacity/capacity.ts`](src/domain/capacity/capacity.ts)). Rows exist only for **enabled** participants. Minutes are non-negative integers.

### Team-entry lifecycle

- **Registration** (`POST sprint-register`, `{teamId?, sprint, seed?}`): upserts **one team's** entry for a native Sprint on the team's board — the explicit `teamId`, or the config's only team when omitted (ambiguous with several teams → `VALIDATION_FAILED`, as on every team-scoped endpoint). A new entry gets the team's next `sequence` and a seeded capacity document at `capacityRevision` 1. On re-register (name/date edits), snapshots refresh; when dates change, non-customized rows track the recomputed default; enabled participants missing a row are added.
- **Settings save** (`POST config`): `putConfig` immediately reconciles every team's **existing** Sprints with the saved config (`reconcileSprintsWithConfig` in [`src/backend/handlers.ts`](src/backend/handlers.ts)) — rows for newly joined participants are backfilled (bumping the team's revision) — so roster changes show up on the planner right after saving, not only after the next `sprint-register`. A brand-new team has **no** Sprints until it registers its own.
- **No lazy entry materialization**: writes against a Sprint the team never registered fail with `NOT_FOUND` — the planner registers the Sprints it creates. (Individual *rows* still seed lazily: a participant who joined the team after a Sprint was seeded gets their row on their first capacity edit.)
- **Team removal is non-destructive**: entries of teams no longer in the config are **retained in storage** but hidden from every view and never touched by mutations (the reminder workflow skips them too).

---

## `scpReminderStateJson` — workflow stamp (v1)

Written **only** by [`src/workflows/workflow-availability-reminder.js`](src/workflows/workflow-availability-reminder.js); the backend never reads or writes it and it is not schema-validated by the app:

```json
{ "version": 1, "remindedOn": { "team-1/143-7": "2026-07-16" } }
```

`remindedOn[key]` is the `yyyy-mm-dd` day the project's reminder pass last handled that upcoming Sprint — it makes the daily scheduled rule self-limiting (one issue does the project's pass; the rest short-circuit). Reminder units are **per team** in the v4 era (keys `teamId/sprintId`, lead from the team's own `reminderLeadDays`); stamps written against v2/v3 documents use plain Sprint-id keys. Stamps for Sprints that started or disappeared are dropped (any key era). See [`WORKFLOWS.md`](WORKFLOWS.md).

---

## `scpPrefsJson` — per-user preferences (User property)

The only **User**-scoped property, served by the project-independent `GET/POST prefs` endpoints (`userEndpoint` in [`src/backend/index.ts`](src/backend/index.ts), `getPrefs`/`savePrefs` in [`src/backend/handlers.ts`](src/backend/handlers.ts)); each caller reads and writes **their own** property only:

```json
{ "lastProjectKey": "AGP", "lastTeamByProject": { "AGP": "team-2" } }
```

Unversioned and disposable: it remembers the main-menu planner's last-picked project — and, per project, the last-picked **team** (multi-team projects reopen on that team) — **server-side per user**, because the sandboxed widget iframe has no reliable `localStorage` (the widget keeps a best-effort local copy as a fallback). `POST prefs` is a merge-update: `lastProjectKey: null` clears the project, `lastTeam: {projectKey, teamId}` remembers a team (`teamId: null` forgets it), absent fields stay unchanged. The property is removed entirely when empty; malformed content parses as empty (`UserPrefs`/`SavePrefsRequest` in [`src/shared/api.ts`](src/shared/api.ts)).

---

## Schema versions & migrations

Registry: [`src/domain/migrations/registry.ts`](src/domain/migrations/registry.ts); framework: [`src/domain/migrations/migrations.ts`](src/domain/migrations/migrations.ts).

| Document | Constant | Current |
| --- | --- | --- |
| Config (`scpConfigJson`) | `CURRENT_CONFIG_VERSION` | **4** |
| Sprint data (`scpSprintDataJson`) | `CURRENT_SPRINT_DATA_VERSION` | **4** |
| Capacity (nested) | `CURRENT_CAPACITY_VERSION` | **2** (unchanged by v3/v4; its migration list is empty) |

**Migrate on read, persist on write.** [`src/backend/storage.ts`](src/backend/storage.ts) runs the registered chain when it loads a document (`normalizeConfigDocument` / `normalizeSprintData`), then strict-validates the result. There is **no write-on-read** — a migrated document is persisted only by the next regular write, so a project nobody edits after an upgrade keeps its old JSON indefinitely (which is why the workflow is version-tolerant). Unreadable documents — malformed JSON, failed validation, a version *newer* than the target, or v1 — are treated as **absent**. The chains compose: a v2 document migrates v2 → v3 → v4 in one read.

**v2 → v3 (teams).** v2 was the first project-scoped schema: one flat `participants` list in the config, one capacity/focus-factor per Sprint entry. The migration wraps existing data into a single default team (`DEFAULT_TEAM_ID` = `team-1`, named `"Team 1"` — the same id/name "Add team" would generate), so upgraded projects behave exactly as before:

- config: `participants` moves into `teams[0].participants`; the v2 `managersGroup` field is deliberately **dropped** (managers are exactly the holders of YouTrack's `UPDATE_PROJECT` permission — no app permission scheme); and the pre-v0.3 shipped default name template `AppGlass {year}-S{sequence}` (demo branding, never user intent) is rewritten to the current default `Sprint {sequence}` — any other template is left untouched;
- sprint data: each entry's `capacityRevision`/`capacity`/`focusFactor`/`focusFactorSource`/`focusFactorOverride`/`excludedFromCalibration`/`calibrationSkipReason` move under `teams["team-1"]`; sprint-level `sequence`/`name`/`start`/`finish`/`createdAt`/`updatedAt` stay put.

**v3 → v4 (separated teams).** v3 teams shared the project's board, cadence and every other planning setting; v4 moves it all into each team. Upgraded projects behave exactly as before until someone edits a team:

- config: every project-level setting (`boardId`, effort fields, `hoursPerDay`, `sprintLengthDays`, `datePolicy`, `nameTemplate`, `backlogQuery`, `learningRate`, `reminderLeadDays`) is copied **into every team**; a team's own non-empty (trimmed) v3 `backlogQuery` override wins over the project-level query; the project-level `reminderLeadDays` becomes each team's override (absent stays absent);
- sprint data: re-keyed **team-first** — `sprints[sprintId].teams[teamId]` → `teams[teamId].sprints[sprintId]` — with each entry's shared Sprint fields (`sequence`, `name`, `start`, `finish`, `createdAt`, `updatedAt`) folded into every team's copy; a Sprint two teams shared lands in **both** teams' maps. All v3 teams shared one board, so the native Sprint ids remain valid for each team.

**v1 has no upgrade path.** v1 documents were keyed by REST database ids, which cannot be mapped to logins offline; the app was pre-release, so readers treat v1 as absent.

Framework invariants: migrations are **sequential** (`fromVersion N → N+1`, a missing step throws), **idempotent**, **pure** (never mutate input), preserve unknown fields, and refuse downgrades (a newer-than-target version parses as absent).

---

## Scale & concurrency

**Property size.** Verified on a real 2025.3 instance: a 1.13 MB `scpSprintDataJson` (200 sprints × 2 teams × 10 rows each) imports in ~0.5 s and exports back fully. Realistic usage — a few teams, years of biweekly Sprints — stays far below that; no pruning is needed.

**Concurrency.** Extension-property writes are **last-write-wins** on the platform: two overlapping backend requests each read-modify-write the *whole* document, and neither transaction aborts (verified: concurrent capacity writes to two **different** teams lost one update 5/5 rounds when driven raw). Teams write **disjoint per-team subtrees** (`teams[teamId]`) of the *same* property, so the shape change doesn't remove the race. Same-team races are caught by the per-team `capacityRevision` check (`CAPACITY_REVISION_CONFLICT`). The silent cross-team window is healed **client-side**: `writeCapacityVerified` in [`src/widgets/api-client.ts`](src/widgets/api-client.ts) (and the focus-factor override) write, re-read the fresh document in a new request, verify the delta actually persisted, and re-apply it on top of the other team's write (bounded retries, 3 attempts; same-team conflicts are still thrown to the caller). Raw API callers (scripts) should serialize their own writes per project.

---

## Audit fields

| Field | Where | Records |
| --- | --- | --- |
| `updatedAt` / `updatedBy` | capacity row | last edit (UTC ms + editor's login) |
| `createdAt` / `updatedAt` | `TeamSprint` | entry creation / last app-state change (per team per Sprint) |
| `ConfigDocument.revision` | config | monotonic config revision |
| `TeamSprint.capacityRevision` | per team per Sprint | monotonic capacity revision |
| `FocusFactorOverride.{userId,timestamp,reason,oldValue,newValue}` | team Sprint entry | who overrode the Focus Factor, when, and why |

---

## Export / import

`GET export` (manager-only) returns an `ExportBundle` ([`src/shared/api.ts`](src/shared/api.ts)) — always at the **current** schema version, with the whole per-team Sprint map (retained entries of removed teams included):

```json
{
  "exportedAt": 1752624000000,
  "configRevision": 4,
  "config": { "...ProjectConfig v4 or null" },
  "teams": { "team-1": { "sprints": { "143-7": { "...TeamSprint v4" } } } }
}
```

`POST import` (manager-only, `{bundle, dryRun}`) accepts bundles from **any supported schema era**: the handler wraps the bundle's documents into their persisted shapes and runs the same migrate-then-validate path the storage layer uses, so a **v0.2.0 pre-teams export stays restorable** after the upgrade. v4 bundles carry a `teams` map; older exports carry a bare `sprints` entry map without a version, so the era is inferred from the entry shape (v3 entries hold a `teams` map, v2 entries are flat; an empty map parses as v3 and migrates trivially). `dryRun: true` reports `{applied: false, sprintCount, configured}` without writing (`sprintCount` counts distinct native Sprint ids across teams). On apply, the config is saved with the current revision + 1 and the Sprint data is replaced wholesale. Import never creates or modifies **native** Sprints.
