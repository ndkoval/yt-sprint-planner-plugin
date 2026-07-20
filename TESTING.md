# Testing

The suite is a pyramid: many fast, hermetic tests at the base; a small number of instance and browser tests at the top that self-skip without an instance. All commands come from [`package.json`](package.json).

| Layer | Location | Command | Needs a YouTrack instance? |
| --- | --- | --- | --- |
| Unit | `tests/unit` | `npm run test:unit` | no |
| Contract | `tests/contract` | `npm run test:contract` | no |
| Coverage (unit+contract) | — | `npm run coverage` | no |
| Real-YouTrack integration | `tests/youtrack` | `npm run test:integration` | **yes** (local, gated) |
| E2E (Playwright) | `tests/e2e` | `npm run test:e2e` | **yes** (self-skips) |
| UI-artifact analysis | — | `npm run test:e2e:analyze` | no |
| Full fast lane | — | `npm run test:all` | no |

`npm run test:all` = `lint → typecheck:all → test:unit → test:contract → build`.

---

## Unit tests (`tests/unit`)

Pure domain-library tests: [`capacity`](tests/unit/capacity.test.ts), [`effort`](tests/unit/effort.test.ts), [`focus-factor`](tests/unit/focus-factor.test.ts), [`dates`](tests/unit/dates.test.ts), [`naming`](tests/unit/naming.test.ts), [`permissions`](tests/unit/permissions.test.ts), [`migrations`](tests/unit/migrations.test.ts), [`schemas`](tests/unit/schemas.test.ts), [`units`](tests/unit/units.test.ts), plus a barrel export check.

Coverage is enforced by [`vitest.config.ts`](vitest.config.ts): `src/domain/**` must hold **≥ 95% statements/functions/lines, ≥ 90% branches** (the correctness-critical core; effectively 100% domain coverage). Reports land in `artifacts/coverage/`.

```bash
npm run test:unit
npm run coverage      # unit + contract with V8 coverage
```

---

## Contract tests (`tests/contract`)

Exercise the whole backend (router, services, repositories, reconciliation) against the **in-memory fake transport** [`fake-youtrack.ts`](tests/contract/fake-youtrack.ts) — the *only* thing mocked is the `YouTrackClient` boundary. Extension properties round-trip through a per-entity store, so persistence, revisions, and reconciliation are observable, and the fake can inject faults. Suites: capacity, config, sprints, focus-factor, metrics-reconciliation, diagnostics-export-import, and errors.

```bash
npm run test:contract
```

---

## Real-YouTrack integration (`tests/youtrack`)

Drives the live REST API of a **local, disposable** YouTrack Server — **no Docker**. The orchestrator [`run-integration.mjs`](scripts/run-integration.mjs) runs *provision → seed → vitest → cleanup* (cleanup always runs in `finally`). The vitest suite [`integration.test.ts`](tests/youtrack/integration.test.ts) self-skips when `YT_TEST_BASE_URL` is unset.

**Harness scripts** ([`scripts/`](scripts/), shared guards in [`lib/yt-env.mjs`](scripts/lib/yt-env.mjs)):

| Script | npm command | Role |
| --- | --- | --- |
| `provision-youtrack.mjs` | `provision:youtrack` | Download a **pinned** YouTrack Server ZIP, unpack, launch `bin/youtrack.sh` on a local port, poll readiness, write `artifacts/test-environment-manifest.json`. |
| `seed-youtrack.mjs` | `seed:youtrack` | Create an isolated project/board/fields/users via REST, namespaced by run id. |
| `cleanup-youtrack.mjs` | `cleanup:youtrack` | Delete seeded entities, stop the process, remove temp dirs; writes `artifacts/orphan-cleanup-report.json`. |

**Environment variables** (copy [`.env.example`](.env.example) → `.env`, git-ignored):

| Var | Purpose |
| --- | --- |
| `YT_TEST_BASE_URL` | Local instance URL. **Unset ⇒ every integration/E2E test self-skips.** |
| `YT_TEST_ADMIN_TOKEN` | Permanent admin token for REST bootstrap. |
| `YT_TEST_MANAGER_/ALICE_/BOB_LOGIN`/`_PASSWORD` | Persona credentials. |
| `YT_TEST_PROJECT_PREFIX` | Isolation prefix; seeded project = `<PREFIX>_<runId>`. |
| `YT_TEST_ALLOW_DESTRUCTIVE` | **Must be exactly `true`** to allow provision/seed/cleanup. |
| `YT_TEST_PORT`, `YT_TEST_READY_TIMEOUT_MS`, `YT_TEST_MIN_VIDEO_SEC` | Optional tuning. |
| `YT_TEST_ALLOW_NONLOCAL` | Undocumented escape hatch for disposable CI only. |

**Safety gates** (`lib/yt-env.mjs`):

- **Destructive gate** — `assertDestructiveAllowed` refuses to run unless `YT_TEST_ALLOW_DESTRUCTIVE=true`.
- **Production block** — `assertNotProduction` accepts only `localhost` / `127.0.0.1` / `[::1]` / `*.local`, and always blocks `*.youtrack.cloud` / `*.jetbrains.*`.
- **Isolation naming** — `makeRunId()` produces a sortable timestamp + random suffix so parallel runs never collide; tests clean up their own project/board in `afterAll`.

```bash
cp .env.example .env    # fill in a LOCAL instance + YT_TEST_ALLOW_DESTRUCTIVE=true
npm run test:integration
```

> Several endpoints here (extension-property read/write, app install, group membership) are `// SPIKE` and mirror the SPIKEs in [`youtrack-http-client.ts`](src/backend/repositories/youtrack-http-client.ts).

---

## Playwright E2E (`tests/e2e`)

Config: [`playwright.config.ts`](playwright.config.ts). `baseURL` = `YT_TEST_BASE_URL`; the whole suite (and each spec) **self-skips when it is unset**, so a run without an instance reports all-skipped, not failed. Run via [`run-e2e.mjs`](scripts/run-e2e.mjs) (ensures artifact dirs exist first).

**Personas** ([`fixtures/personas.ts`](tests/e2e/fixtures/personas.ts)): `manager`, `alice`, `bob`, `unauthorized` — each with its own storage-state file materialised by the `setup` project ([`auth.setup.ts`](tests/e2e/auth.setup.ts)).

**Critical vs regression** journeys map to Playwright projects:

| Project | Spec pattern | Capture policy (§28) |
| --- | --- | --- |
| `critical` | `*.critical.spec.ts` (lifecycle, configuration, availability, permissions) | `video: 'on'`, `trace: 'on'`, `screenshot: 'on'` — **always** |
| `regression` | `*.regression.spec.ts` (scope-changes) | `video`/`trace` `retain-on-failure`, `screenshot: 'only-on-failure'` |

Reports: HTML + JSON → `artifacts/playwright-report/`; traces/videos/screenshots → `artifacts/test-results/`.

**Accessibility (§27):** [`fixtures/axe.ts`](tests/e2e/fixtures/axe.ts) runs `@axe-core/playwright` with `wcag2a`/`wcag2aa`; **serious/critical** violations fail the test, minor/moderate are logged as warnings, and the full axe report is attached.

```bash
npm run test:e2e
npm run test:e2e -- --project=setup --project=critical      # subset
```

> The specs currently use placeholder selectors pending a live UI (a `// SPIKE` — see [`CHANGELOG.md`](CHANGELOG.md)).

---

## Video/trace/contact-sheet analysis (§28–29)

[`analyze-ui-artifacts.mjs`](scripts/analyze-ui-artifacts.mjs) (`npm run test:e2e:analyze`):

- reads the Playwright JSON report (`artifacts/playwright-report/report.json`);
- finds videos under `artifacts/test-results/**` and `artifacts/videos/**`;
- uses **ffprobe** for per-video metadata and **ffmpeg** for integrity: exists, decodes, `duration ≥ YT_TEST_MIN_VIDEO_SEC` (default 1s), resolution present, **not all-black / all-white** (luma thresholds 16 / 239);
- builds `4×4` **contact sheets** into `artifacts/contact-sheets/`;
- writes [`tests/video-analysis/video-integrity.json`](tests/video-analysis/video-integrity.json) and `artifacts/ui-analysis.md`.

It degrades gracefully when ffprobe/ffmpeg or the report are missing (marks checks *skipped*) and exits non-zero **only** on real integrity failures (exists but won't decode / too short / entirely black or white).

```bash
npm run test:e2e:analyze
```

---

## Artifact publishing

[`publish-test-summary.mjs`](scripts/publish-test-summary.mjs) (`npm run publish:test-summary`) assembles `artifacts/index.html` linking the app ZIP, coverage, Playwright report, contact sheets, videos, `ui-analysis.md`, `video-integrity.json`, the environment manifest, and the cleanup report — a single browsable entry point for CI. It never fails on missing artifacts.

---

## CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))

- **`build-and-test`** (every push/PR): `npm ci → lint → typecheck:all → test:unit → test:contract → build → pack`, then uploads `dist/sprint-capacity-planner.zip`.
- **`security-and-review`**: placeholder steps for the security / code-review plugins.
- **`youtrack`** (manual dispatch, opt-in, protected environment, `continue-on-error`): installs Playwright + ffmpeg, builds/packs, provisions the local no-Docker instance, runs integration + E2E (critical & regression), analyses UI artifacts, tears down, and uploads all reports.

## Self-contained demo E2E suite (runs anywhere)

`tests/e2e/demo` drives the **real** widget bundles against the **real** backend, wired to
an in-memory YouTrack (the same transport fake the contract tests use) and served by
`scripts/serve-demo.mjs`. It needs no live YouTrack, so it runs on any platform and in CI.

```bash
npm test                                     # full gate — also records the demos
npm run test:e2e:demo                        # just the demos: builds widgets, records 10 journeys,
                                             #   writes subtitles + ui-analysis.md (APPROVE/FIX verdict)
npm run demo:serve                           # (optional) serve the demo at http://localhost:8090 to explore
```

**Running the tests produces the demos.** `npm test` / `npm run test:all` end by recording the
full demo suite. Four of the journeys are **marketing reels** — `00-product-walkthrough`,
`00b-team-capacity-reel`, `00c-team-configuration-reel`, `00d-installation-reel` — recorded like
a real person: a branded **title card** at the start, a visible gliding **cursor**, human pacing,
**720p**, on-screen **subtitles** plus a **WebVTT** track under `artifacts/demo/subtitles/`, and a
**voiceover** `.mp4` under `artifacts/demo/reels/` (macOS `say` → timed narration muxed onto the
video; skipped gracefully where TTS/ffmpeg are absent). See also the launch
[blog post](docs/blog/announcing-sprint-capacity-planner.md).

Journeys (13): the four **marketing reels**, overview/metrics, create-next-Sprint, member
availability (own-row-only editing), manager controls (focus-factor override), settings, **team
workflow** (create → set availability), **auto remaining capacity** (adding a task lowers
remaining capacity automatically — no Refresh), **sprint navigation** (switch Sprints + open the
**Kanban board** to see issues and jump into a Sprint), and **per-assignee planning** (Assigned
load + Unassigned bucket). Each records a video,
runs an axe accessibility scan, and asserts no console/page errors. The suite is **deterministic
and independent of run order** — an auto-fixture resets the harness world before every test, so
these are plain web tests that need no AI to run. Chromium runs **headless** (no window steals
focus) in an **isolated context per test** that closes at the end. Artifacts + `ui-analysis.md`
(with an APPROVE / FIX REQUIRED verdict) land under `artifacts/demo/`.

> **Platform note:** the live-YouTrack path (`test:integration`) needs Linux x64 — the
> standalone YouTrack 2025.1 build bundles GraalVM/Truffle 22, whose scripting engine cannot
> start on Apple-Silicon macOS (see CHANGELOG → Platform notes). The demo suite above covers
> the plugin UI end-to-end everywhere.
