# Sprint Capacity Planner

> Capacity planning, computed delivery metrics, and one-click next-Sprint — layered on **native** YouTrack Sprints.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/ndkoval/yt-sprint-planner-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/ndkoval/yt-sprint-planner-plugin/actions/workflows/ci.yml)
[![YouTrack 2024.3+](https://img.shields.io/badge/YouTrack-2024.3%2B-2CAEF0.svg)](https://www.jetbrains.com/youtrack/)

A YouTrack App that adds **capacity planning, computed delivery metrics, and a one-click "create next Sprint" button** on top of *native* YouTrack Sprints. The native Sprint stays the single source of truth — the app only layers planning data and calculations over it, so your board, issues, and fields are never forked or duplicated.

## See it in action

[![Watch the demo](docs/media/demo-poster.png)](docs/media/demo.mp4)

**▶ [Watch the demo](docs/media/demo.mp4)** — add the app to a project and configure it (including splitting a big project into small teams), plan a Sprint per team on the drag-and-drop board, and see two projects planned independently side by side. Also available separately: **[install & configure](docs/media/install.mp4)** · **[walkthrough](docs/media/walkthrough.mp4)** · **[multiple projects](docs/media/multi-project.mp4)**. The videos are recorded automatically against a real YouTrack.

> 📦 **JetBrains Marketplace:** _listing coming soon._

## Features

- **Per-person capacity planning** per Sprint (working-days × hours, with part-time allocations and per-row overrides).
- **Fully separated teams inside one project** — split a big project into teams that plan completely independently: each team owns its board, Sprint cadence and naming, effort fields, backlog filter, focus factor and reminders (teams may share a board or run their own, on different schedules; the same person may serve on several teams).
- **Per-team configuration** — every planning setting belongs to a team (the project just holds the team list); plan any number of projects — and teams within them — independently.
- **Team switcher that swaps the whole context** — board, Sprint list and cadence follow the selected team, and the planner remembers each user's last team per project.
- **Drag-and-drop planning board** — pull issues from the team's backlog onto teammate lanes, leave work unassigned, or drag it back; over-capacity is highlighted per person and for the whole team.
- **Computed metrics** — capacity (raw/planned/remaining) and effort (original/current/completed) per team, plus missing-effort warnings.
- **Learned Focus Factor** — observed per completed Sprint and calibrated per team.
- **One-click next Sprint** — created per team on the team's own board: computed name, dates, sequence, seeded capacity, and optional carry-over.
- **No custom permission scheme** — whoever can change the project's settings in YouTrack (`UPDATE_PROJECT`) manages its planning; members edit their own availability, from the settings tab or the global **Sprint Capacity Planner** menu item.
- **Manager diagnostics + export/import** — a data-health view and a versioned JSON backup bundle (old bundles import across schema upgrades).

It deliberately does **not** create service/placeholder issues, track committed scope, or add locks/approval gates. See [`docs/JIRA_ALIGNMENT.md`](docs/JIRA_ALIGNMENT.md) for how the model maps onto Jira.

## Screenshots

| | |
| --- | --- |
| **Capacity table** — per-person default/available capacity with live load bars | ![Capacity table](docs/media/screenshots/01-capacity.png) |
| **Planning board** — drag issues from the backlog onto teammate lanes; over-capacity is flagged | ![Planning board](docs/media/screenshots/02-planning-board.png) |
| **Issue overlay** — double-click a card to view and edit the issue without leaving the plan | ![Issue overlay](docs/media/screenshots/03-issue-overlay.png) |
| **Next Sprint in one click** — computed name, dates and optional carry-over | ![Create next Sprint](docs/media/screenshots/04-create-next-sprint.png) |
| **Settings** — board, effort fields, schedule, backlog query and focus-factor calibration | ![Settings](docs/media/screenshots/05-settings.png) |

## Install

Requires YouTrack **2024.3+** (Cloud or Server).

1. Download `sprint-capacity-planner.zip` from a [release](https://github.com/ndkoval/yt-sprint-planner-plugin/releases) (or build it: `npm ci && npm run build && npm run pack`).
2. In YouTrack: **Administration → Apps → Import app**, upload the ZIP.
3. Attach the app to a project, then open its **Sprint Capacity** tab → **Settings** to define your team(s) — each team picks its own board, effort fields, schedule, and backlog query.

> **Before uninstalling:** all app data lives in `scp*` extension properties and is removed on uninstall (native Sprints/issues are untouched). Export a backup bundle from the manager diagnostics first.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DATA_MODEL.md`](DATA_MODEL.md) · [`WORKFLOWS.md`](WORKFLOWS.md) · [`SECURITY.md`](SECURITY.md) — design, persisted shapes, workflow rules, and the permission matrix.
- [`AGENTS.md`](AGENTS.md) — **development, testing, and demo-recording guide** (build/test commands and the real-YouTrack policy).
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.

## Status

**v0.4.0 (unreleased):** teams are now fully separated — every planning setting (board, cadence, effort fields, backlog, reminders) belongs to a team, implemented across the domain, backend, widgets and the reminder workflow, with existing v2/v3 data migrated automatically on read. Verified end-to-end against a real YouTrack **2025.3**: 275 unit + 101 contract tests, the full 32-test Playwright E2E suite (per-team boards, cadences and backlogs included), and the three demo reels re-recorded against the per-team model. Known limitations are tracked as [`known-limitation`](https://github.com/ndkoval/yt-sprint-planner-plugin/issues?q=is%3Aissue+label%3Aknown-limitation) issues.

## Contributing

Issues and pull requests are welcome. Run `npm run test:all` before opening a PR — see [`AGENTS.md`](AGENTS.md).

## License

Licensed under the **[Apache License 2.0](LICENSE)**. © 2026 Nikita Koval.
