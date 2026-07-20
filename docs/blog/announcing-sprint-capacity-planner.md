# Plan two‑week Sprints with confidence — introducing Sprint Capacity Planner for YouTrack

*Capacity planning, computed metrics, and a one‑click next‑Sprint button — right on top of your existing YouTrack Agile Board. No service issues, no locks, no busywork.*

Every team that runs two‑week Sprints eventually asks the same three questions:

1. **How much can we realistically take on this Sprint?**
2. **Is everyone actually available — or are we planning around a conference and two vacations?**
3. **Are we still on track now that scope has changed?**

YouTrack already has great native Sprints and issues. What it doesn’t have is a lightweight, honest way to answer those questions without spreadsheets. **Sprint Capacity Planner** adds exactly that — and nothing you don’t need.

## What it adds

- **Per‑person capacity, per Sprint.** Working‑days × hours gives each person a default; everyone can adjust their own *Available* days, add a note (“Conference Mon–Tue”), and **confirm** — confirmation is informational and *never blocks* the team.
- **Computed capacity metrics.** Raw, Confirmed, and **Planned** capacity (Raw × a learned Focus Factor), plus **Remaining capacity** that updates automatically as work is estimated.
- **Effort that stays honest.** Original and Current effort roll up from the issues in the Sprint; resolved issues stop counting; a **Completed Original Effort** and **Observed Focus Factor** are computed when the Sprint ends, and the *next* Sprint’s Focus Factor is nudged toward what actually happened.
- **One‑click “Create next Sprint.”** Name, dates, sequence, and Focus Factor are all computed for you; the Sprint is created on your **native** board via REST.

## What it deliberately leaves out

The native Sprint stays the single source of truth. There are **no** service issues, **no** committed‑scope snapshots, **no** locks or unlocks, **no** manual finalize step, and **no** time tracking. You keep working with normal YouTrack Sprints and issues — the app just adds the planning layer and the math.

## How it works

- The **project tab** shows the capacity table, the capacity/effort summaries, and a data‑health indicator.
- **Workflows** update metrics incrementally as issues change; a **backend reconciliation** is the authoritative recompute (there’s a Recalculate button, and it also runs on a schedule).
- Everything is stored in **app‑owned extension properties on the native Sprint** — versioned JSON, with migrations and export/import.
- Every mutation is **authorized server‑side**; edits use **optimistic concurrency** so two people editing at once never lose each other’s changes.

## See it in action

Two short, subtitled screen recordings ship with the project — both recorded **inside a YouTrack instance** (the app installed as widgets, the native Kanban board), with a visible cursor and human pacing, against a fixed prepared data set:

| Reel | What it shows | Video | Subtitles |
| --- | --- | --- | --- |
| **Install & configure** | Installing the app from one ZIP, then setting it up in the single Sprint Capacity tab — board, effort-field pickers, the backlog search, the focus-factor explanation, and the team with part-time allocations | `artifacts/demo/test-results/01-setup-*/video.webm` | `artifacts/demo/subtitles/01-setup.vtt` |
| **App walkthrough** | The whole app: per-person capacity (incl. part-time), the drag-and-drop planning board (pull from the backlog, move back, leave work unassigned, double-click to open an issue), over-capacity highlighting, one-click next Sprint, and the native board | `artifacts/demo/test-results/02-walkthrough-*/video.webm` | `artifacts/demo/subtitles/02-walkthrough.vtt` |

Regenerate them anytime — running the demo suite against a YouTrack *is* how the demos are produced:

```bash
npm run demo          # provisions a YouTrack, records all reels, renders + QAs the videos
npx playwright show-report artifacts/demo/playwright-report   # watch the videos + traces
```

## Try it

```bash
npm ci
npm run build && npm run pack   # → dist/sprint-capacity-planner.zip
```

Install the ZIP in YouTrack, attach it to a project, open the **Sprint Capacity** tab and hit **Settings** to pick your board and effort fields, then plan on the board and click **Create next Sprint**. That’s the whole setup.

*Sprint Capacity Planner — plan with confidence, no busywork.*
