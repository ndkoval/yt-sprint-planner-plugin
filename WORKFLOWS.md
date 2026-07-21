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

1. Parse `scpSprintDataJson` from `issue.project.extensionProperties`; bail unless it is a v2 **or** v3 document with a `sprints` map.
2. Resolve the lead window: the project config's `reminderLeadDays` (from `scpConfigJson`) **wins** over the app-level `reminderLeadDays` setting ([`settings.json`](settings.json)); both default to 3. **`0` disables reminders for the project entirely.**
3. For each Sprint entry whose `start` lies in `[now, now + leadDays]` and that has not been handled today: walk every capacity-row map, and for each row still at the default, `entities.User.findByLogin(login).notify(...)`.
4. Stamp `remindedOn[sprintId] = today` in `scpReminderStateJson`; drop stamps for Sprints that no longer exist or have already started.

### Self-limiting stamp design

`onSchedule` rules run **per matching issue**, but all app state is project-scoped. So the **first** matching issue of a project performs the *whole project's* reminder pass and writes the per-day stamp to `scpReminderStateJson`; every other issue that day short-circuits on the stamp. One issue is enough to reach the project's extension properties, and no issue-level guard is needed.

### Version tolerance (v2 AND v3)

The rule reads the **raw** extension-property JSON — it does not go through the backend's migration path. Because documents migrate **lazily** (on the backend's next write, see [`DATA_MODEL.md`](DATA_MODEL.md)), a project nobody edits after the v0.3.0 upgrade keeps v2 JSON indefinitely. `capacityRowMaps(entry)` therefore accepts both eras: v3 keeps one capacity document per team under `entry.teams`; v2 kept a single `entry.capacity` at the top level.

### Platform caveat

The rule only fires in projects that have at least one issue matching `#Unresolved`. A project with **zero unresolved issues gets no reminder pass** — its upcoming Sprints' participants are simply not nudged that day. This is accepted: a scheduled rule needs *some* issue to piggyback on, and a project with no open work has little to plan.

### Testing

The module exports `_internals` (`remindForProject`, `capacityRowMaps`, `leadDaysOf`) so [`tests/unit/workflow-reminder.test.ts`](tests/unit/workflow-reminder.test.ts) can drive it with a stubbed scripting API — both document eras, the lead-day override/disable logic, and the stamp lifecycle are covered without an instance.
