# Changelog

All notable changes to the Sprint Capacity Planner are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (simplification)

- **Removed capacity confirmation entirely** — it was a redundant extra step. Gone from the model (`CapacityRow.confirmed`), the API (confirm/unconfirm endpoints, `confirmedCapacityMinutes`), the capacity table (Confirmed column) and summary (Participants-confirmed / Confirmed-capacity). The availability reminder workflow now nudges people who haven't *set* their availability instead.
- **No manual Refresh** — the project tab auto-refreshes (polls) so metrics stay live as issues change; the Refresh button is gone.
- **No manual Recalculate** — `GET /sprints/:id` now computes all metrics live from the current issue set, so reads are always current; the Recalculate button is gone (reconciliation still runs on mutations + on schedule to keep the cache warm).

### Added (demos)

- **Kanban board** — the board view is now a Kanban with **sprints enabled** (one swimlane per Sprint, To Do / In Progress / Done columns, issue cards); the sprint-navigation demo asserts it.
- **Title cards** — each marketing reel opens with a branded title card so the video introduces itself.
- **Voiceover** — `scripts/render-reels.mjs` synthesizes timed narration from each reel's WebVTT (macOS `say`) and muxes it onto the video as an H.264 `.mp4` under `artifacts/demo/reels/` (baked captions + narration). Degrades gracefully where TTS/ffmpeg are absent.

### Added (per-assignee planning)

- **Assign tasks to people while planning, with an Unassigned bucket.** Effort now rolls up per assignee (the issue's Assignee) as well as in total. The capacity table shows each person's **Assigned** load (with an over-capacity ⚠ when it exceeds their available days), and the effort summary shows the **Unassigned** remainder — so you can balance the team while leaving work owned by project direction rather than forced onto a person. Assigned load updates automatically as issues change. New `assigneeId` on issues; `aggregateEffort` returns `byAssignee` + `unassigned`; `SprintView` gains `assignedEffort` + `unassignedEffort`. Covered by unit + contract tests and the `09-assignment` demo.

### Added (marketing)

- **Two more marketing reels:** `00c-team-configuration-reel` (board / effort fields / schedule / naming / team / save) and `00d-installation-reel` (install from one ZIP → attach → open settings, over a simulated YouTrack install screen). Both cursored + subtitled (WebVTT), bringing the reel set to four.

### Fixed

- **Completed-effort window was ~24h short (audit).** The "resolved within the Sprint" upper bound used midnight of the finish day, so work closed on the last Sprint day was excluded from Completed Original Effort — understating Observed Focus Factor and mis-calibrating the next Sprint. Now inclusive of the whole finish day (`endOfDayUtcMs`), with unit + contract tests.
- **Capacity reset / confirm / unconfirm now enforce optimistic concurrency (audit).** They previously bypassed the revision check (last-write-wins); they now require `expectedRevision` and return `409` on a stale revision, like `PATCH capacity`.
- **`PUT /config` returned only `{ configRevision }`** but the widget expects a full `ConfigResponse`; it set the live config to `undefined` and the settings form never showed "Settings saved." Now returns the full response (caught by the team-configuration reel).

### Changed

- **Everyone is planned at 100% — per-person allocation removed** from the config, capacity rows, schemas, domain, and UI (settings team table + capacity table). Default capacity is `workingDays × hoursPerDay × 60`.
- **Capacity table simplified** — removed the Allocation, "Updated by", and Reset columns; Default and Available now render as plain day numbers (floats) rather than periods.
- **New "Remaining capacity" metric** (`Planned Capacity − Current Effort`) shown in the capacity summary; it updates automatically as issues are added/estimated/resolved.
- **Sprint deep-linking** — the project tab accepts `?sprint=<id>` to preselect a Sprint.

### Added

- **Two marketing reels, recorded like a human** — `00-product-walkthrough` (full story) and `00b-team-capacity-reel` (whole-team availability + confirmation). Both feature a visible gliding **cursor**, human pacing, crisp **720p**, on-screen **subtitles** plus a **WebVTT** track (`artifacts/demo/subtitles/*.vtt`), and a launch **blog post** ([`docs/blog/announcing-sprint-capacity-planner.md`](docs/blog/announcing-sprint-capacity-planner.md)).
- **Running the tests produces the demos** — `npm run test:all` (and `npm test`) now build the widgets, record all demo journeys (video/trace/subtitles), and write `artifacts/demo/ui-analysis.md` with an APPROVE/FIX-REQUIRED verdict. A dedicated CI `demos` job uploads the reels + subtitles.
- **Comprehensive product walkthrough demo** ([`tests/e2e/demo/00-product-walkthrough.spec.ts`](tests/e2e/demo/00-product-walkthrough.spec.ts)) — the end-to-end "sales reel" recorded as one video: overview → create next Sprint → member confirms availability → task added → remaining capacity updates automatically → open board.
- **Team-workflow demo** (create → set availability → confirm across Alice/Bob/manager), **auto-remaining-capacity demo** (adding a task lowers remaining capacity with no manual action), and **sprint-navigation demo** (switch Sprints via the selector; open the board to see issues and jump into a Sprint). Board stub + `/__demo` hooks live in [`tests/e2e/harness`](tests/e2e/harness).
- **Deterministic demo suite** — an auto-fixture resets the in-memory world (`/__demo/reset`) before every test, so the 9-journey suite is independent of run order and needs no AI to run: `npm run test:e2e:demo`.
- **Self-contained demo E2E suite** ([`tests/e2e/demo`](tests/e2e/demo), [`playwright.demo.config.ts`](playwright.demo.config.ts)) — drives the **real** widget bundles against the **real** backend wired to an in-memory YouTrack (served by [`scripts/serve-demo.mjs`](scripts/serve-demo.mjs) / [`tests/e2e/harness`](tests/e2e/harness)). Runs on any platform with no live YouTrack, records video/trace/screenshots per journey, and asserts structural accessibility (axe). Verdict from the analyzer: **APPROVE** (5/5 journeys, all videos pass integrity). Commands: `npm run test:e2e:demo`, `ANALYZE_BASE=artifacts/demo npm run test:e2e:analyze`.
- **`SprintSummary.sequence`** — surfaced in `GET /sprints` so the "Create next Sprint" preview derives from the latest managed Sprint.

### Fixed

- **Capacity/focus-factor/calibration mutations returned the wrong shape** — they returned `{capacity, capacityRevision}` / `{override}` / `{excludedFromCalibration}`, but the api-client and widgets expect a full `SprintView`, crashing the UI after any capacity edit or override. These endpoints now reconcile and return the updated `SprintView` (so metrics also refresh live). Verified by the demo E2E suite.
- **Sprint name template placeholders** — the settings default and the create-next preview used `{n}`, which the backend renderer does not understand; aligned to the real `{year}`/`{sequence}`/`{startDate}`/`{finishDate}` placeholders.
- **Create-next preview** now derives from the latest managed Sprint (max sequence) instead of the currently-selected one, matching the backend.
- **`scpLastRecalculatedBy`** is now persisted during reconciliation.
- **Validation errors** now return `400 VALIDATION_FAILED` (were `500`).

### Platform notes

- **Real-YouTrack integration on Apple-Silicon macOS is not supported** by the standalone (no-Docker) build: YouTrack 2025.1 bundles GraalVM/Truffle 22.0.0.2, whose JS scripting engine cannot initialise on arm64 (verified on JDK 8/11/17/21/25 and the bundled JRE under Rosetta — all crash on `sun.misc.Unsafe.ensureClassInitialized`). The headless provisioning + wizard bootstrap in [`scripts/provision-real-youtrack.mjs`](scripts/provision-real-youtrack.mjs) is fully implemented and verified up to that point; run real integration on Linux x64 (CI). The demo E2E suite covers the plugin UI end-to-end everywhere.

### Known SPIKE follow-ups

These integration points are isolated behind `// SPIKE` markers and must be verified/wired against a real YouTrack instance:

- **SDK extension-property read/write wiring** — `getExtensionProperties` / `setExtensionProperties` in [`src/backend/repositories/youtrack-http-client.ts`](src/backend/repositories/youtrack-http-client.ts) are stubs (reads return `null`, writes no-op); the workflow accessors in [`src/workflows/workflow-common.js`](src/workflows/workflow-common.js) assume `entity.extensionProperties[name]`.
- **Board-permission check** — `canManageBoard` is a placeholder ("board is readable"); the real sprint create/update permission query is unverified.
- **Host bridge** — the widget↔host API in [`src/widgets/api-client.ts`](src/widgets/api-client.ts) (`YTApp.register`, `host.fetchApp`, project/user id sources, app base path).
- **YouTrack distribution URL** — pinned build, download URL, and launch flags in [`scripts/provision-real-youtrack.mjs`](scripts/provision-real-youtrack.mjs).
- **Real E2E selectors** — the live-YouTrack specs under [`tests/e2e`](tests/e2e) (excluding [`tests/e2e/demo`](tests/e2e/demo), which uses verified selectors) use placeholder selectors pending a live UI.

Additional unfinished wiring: no API route sets the `scpCapacityManagers` group yet; `reconciliationCron` in [`settings.json`](settings.json) is defined but the reconciliation workflow hardcodes its cron; `scpConfigVersion` is declared but unused (config version lives inside the JSON).

## [0.1.0] - 2026-07-16

### Added

- **Pure domain library** ([`src/domain`](src/domain)) — capacity, effort, focus-factor calibration, calendar/working-day dates, Sprint naming/sequencing, permission decisions, and a sequential/idempotent migration framework + registry. Unit-tested with a ≥95% coverage gate.
- **Shared contracts** ([`src/shared`](src/shared)) — TypeScript types, zod schemas for every persisted JSON document, the HTTP API contract, request-body schemas, and the minutes/UTC unit policy.
- **Backend API** ([`src/backend`](src/backend)) — a transport-agnostic router + full route surface (config, boards, sprints, capacity, focus-factor/calibration, recalculate, diagnostics, export/import) with server-side authorization, zod validation, optimistic concurrency (`expectedRevision` → 409), a structured error envelope with correlation ids, sanitized logging, authoritative reconciliation, and the idempotent create-next-Sprint flow. Backed by the `YouTrackClient` transport boundary.
- **Contract tests** ([`tests/contract`](tests/contract)) — every backend service exercised against an in-memory fake transport with round-tripping extension properties and fault injection.
- **Workflows** ([`src/workflows`](src/workflows)) — six modules (issue-metrics, sprint-membership, issue-removal, completed-sprint, scheduled reconciliation, availability reminder) performing snapshot-based incremental updates that never block issue edits.
- **Ring UI widgets** ([`src/widgets`](src/widgets)) — the Sprint Capacity project tab and the Sprint Capacity Settings form, with a typed API client and isolated host bridge.
- **Build & pack** ([`scripts`](scripts)) — esbuild-based backend/widget builds, static-file assembly into `dist/`, and a pure-Node ZIP writer producing `dist/sprint-capacity-planner.zip`.
- **Local-YouTrack harness** — no-Docker provision/seed/cleanup scripts with destructive + production-URL safety gates and run-id isolation, plus a self-skipping real-integration vitest suite.
- **Playwright E2E scaffolding** ([`tests/e2e`](tests/e2e)) — persona fixtures, critical/regression projects with the video/trace/screenshot capture policy, axe accessibility checks, and a video/contact-sheet integrity analyzer.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) — fast lane (lint/typecheck/unit/contract/build/pack + package upload) and an opt-in, gated real-YouTrack lane.
- **Documentation** — [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`WORKFLOWS.md`](WORKFLOWS.md), [`DATA_MODEL.md`](DATA_MODEL.md), [`TESTING.md`](TESTING.md), and [`SECURITY.md`](SECURITY.md).

[Unreleased]: https://example.com/appglass/sprint-capacity-planner/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/appglass/sprint-capacity-planner/releases/tag/v0.1.0
