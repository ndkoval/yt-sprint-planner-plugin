# Workflows

The app ships **exactly one** workflow rule: the availability reminder, [`src/workflows/workflow-availability-reminder.js`](src/workflows/workflow-availability-reminder.js). It is plain CommonJS (the workflow runtime cannot import TypeScript) and is copied to the **package root** at build time — YouTrack auto-discovers workflow modules only as top-level package scripts (see [`scripts/build.mjs`](scripts/build.mjs)).

There are no metric-maintenance rules: Sprint metrics are **computed live on every read** from the current issue set ([`src/widgets/sprint-view.ts`](src/widgets/sprint-view.ts)), so there is no cache for workflows to keep warm and no on-change bookkeeping.

---

## `workflow-availability-reminder.js` — `Issue.onSchedule`

Once a day, for each upcoming managed Sprint whose start falls within the reminder lead window, notify every participant who has **not** set their availability yet (their capacity row still carries the untouched default, i.e. `availableWasCustomized !== true`). Reminders are informational and never block anything.

**Rule shape**

| Aspect | Value |
| --- | --- |
| Trigger | `entities.Issue.onSchedule`, cron `0 47 7 * * ?` (daily, staggered off-peak minute) |
| Search | `#Unresolved` |
| Notifications | `muteUpdateNotifications: true` — the rule's own writes never spam watchers |
| Failure policy | whole action wrapped in try/catch; one `console.error` line, never escalates |

**Algorithm** (per project, via `remindForProject`):

1. Parse `scpSprintDataJson` from `issue.project.extensionProperties`; bail unless it is a v4 document with a `teams` map **or** a v2/v3 document with a `sprints` map.
2. Flatten the document into **reminder units** (`reminderUnits`), each with its own lead window. **v4:** one unit per *team's* Sprint entry; the lead comes from that team's `reminderLeadDays` in `scpConfigJson` (config v4 makes it a **team** setting), falling back to the app-level `reminderLeadDays` setting ([`settings.json`](settings.json)). A team **absent from the config** (removed; entries are retained in storage) is skipped entirely. **v2/v3:** one unit per Sprint; the project-level `reminderLeadDays` in `scpConfigJson` wins over the app setting. Both default to 3. **`0` disables reminders** — for that *team* in v4, for the whole project in v2/v3.
3. For each unit whose `start` lies in `[now, now + leadDays]` and that has not been handled today: walk every capacity-row map, and for each row still at the default, `entities.User.findByLogin(login).notify(...)`.
4. Stamp `remindedOn[key] = today` in `scpReminderStateJson` — the key is **`teamId/sprintId`** for v4 units, a plain **`sprintId`** for v2/v3; drop stamps whose unit no longer exists or has already started (any key era, so leftover plain-`sprintId` stamps are pruned once a document migrates to v4).

### Self-limiting stamp design

`onSchedule` rules run **per matching issue**, but all app state is project-scoped. So the **first** matching issue of a project performs the *whole project's* reminder pass and writes the per-day stamp to `scpReminderStateJson`; every other issue that day short-circuits on the stamp. One issue is enough to reach the project's extension properties, and no issue-level guard is needed.

### Version tolerance (v2, v3 AND v4)

The rule reads the **raw** extension-property JSON — it does not go through the backend's migration path. Because documents migrate **lazily** (on the backend's next write, see [`DATA_MODEL.md`](DATA_MODEL.md)), a project nobody edits after an upgrade keeps its old JSON indefinitely. `reminderUnits(data, config, appLeadDays)` therefore flattens every supported era into uniform units, and `capacityRowMaps(entry)` accepts all three entry shapes: v4 keeps **one** capacity document at the entry's top level (the entry itself is per-team, under `data.teams[teamId].sprints`); v3 kept one per team under `entry.teams` inside shared entries; v2 kept a single flat `entry.capacity`.

### Platform caveat

The rule only fires in projects that have at least one issue matching `#Unresolved`. A project with **zero unresolved issues gets no reminder pass** — its upcoming Sprints' participants are simply not nudged that day. This is accepted: a scheduled rule needs *some* issue to piggyback on, and a project with no open work has little to plan.

### Testing

The module exports `_internals` (`remindForProject`, `reminderUnits`, `capacityRowMaps`, `leadDaysOf`) so [`tests/unit/workflow-reminder.test.ts`](tests/unit/workflow-reminder.test.ts) can drive it with a stubbed scripting API — all three document eras, the per-team vs. project-level lead override/disable logic, removed-team skipping, and the stamp lifecycle across both key eras are covered without an instance.
