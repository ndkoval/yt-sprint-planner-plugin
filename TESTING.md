# Testing

The suite is a pyramid: many fast, hermetic tests at the base; a small number of instance and browser tests at the top that self-skip without an instance. All commands come from [`package.json`](package.json). Project rule: **tests and demos that touch YouTrack use a REAL YouTrack** — the only fake is the `BackendEnv` seam in contract tests, which never stands in for YouTrack UI (see [`AGENTS.md`](AGENTS.md)).

| Layer | Location | Command | Needs a YouTrack instance? |
| --- | --- | --- | --- |
| Unit | `tests/unit` | `npm run test:unit` | no |
| Contract | `tests/contract` | `npm run test:contract` | no |
| Coverage (unit+contract) | — | `npm run coverage` | no |
| E2E (Playwright) | `tests/e2e` | `npm run test:e2e` | **yes** (self-skips otherwise) |
| Integration | `tests/youtrack` | `npm run test:integration` | **yes** (local, gated) |
| Demo reels | `tests/e2e/demo` | `npm run demo:record:docker` | **yes** (Docker + host instance) |

`npm run test:all` (the pre-PR gate, also `npm test`) = `lint → typecheck:all → test:unit → test:contract → build → test:e2e`. Without `YT_TEST_BASE_URL` the e2e step reports all-skipped, not failed, so the gate runs anywhere.

---

## Unit tests (`tests/unit`)

Pure tests of the domain library, shared schemas, the view assembly and the workflow rule: `capacity`, `dates`, `effort`, `focus-factor`, `metrics`, `migrations` (the v2 → v3 → v4 chains for config and sprint data), `naming`, `permissions`, `schemas`, `teams`, `units`, `sprint-view` (single-team compute-on-read assembly), `workflow-reminder` (the rule's `_internals` driven with a stubbed scripting API — v4 documents plus not-yet-migrated v2/v3 ones), plus a barrel export check.

Coverage is enforced by [`vitest.config.ts`](vitest.config.ts): `src/domain/**` must hold **≥ 95% statements/functions/lines, ≥ 90% branches**. Reports land in `artifacts/coverage/`.

```bash
npm run test:unit
npm run coverage      # unit + contract with V8 coverage
```

---

## Contract tests (`tests/contract`)

Exercise the backend handlers **for real** against the in-memory [`FakeEnv`](tests/contract/fake-env.ts) — only the `BackendEnv` boundary ([`src/backend/env.ts`](src/backend/env.ts): project entity, extension properties, user directory, clock) is faked, and properties round-trip through a plain map so persistence is observable. Native data (sprints, issues) is deliberately **not** modelled: the backend never touches it. Suites: `capacity`, `config`, `sprint-register` (per-team registration and sequences), `focus-calibration`, `export-import-diagnostics` (v4 `teams` bundles plus legacy v2- and v3-era `sprints` bundle imports), `prefs` (last project + last team per project, merge semantics), `storage` (migrate-on-read v2/v3 → v4, v1/garbage handling).

```bash
npm run test:contract
```

---

## Playwright E2E (`tests/e2e`)

Runs against a **real YouTrack** with the app installed. Entry point: [`scripts/run-e2e.mjs`](scripts/run-e2e.mjs).

**Auto-provisioning.** When `YT_TEST_BASE_URL` **and** an admin token (`YT_TEST_ADMIN_TOKEN` or `/tmp/yt25-token.txt`) are present, the runner makes the instance e2e-ready first: build → pack → clean-install the app (UI automation, [`install-app-youtrack.mjs`](scripts/install-app-youtrack.mjs)) → seed the two e2e projects incl. personas and project team membership over Hub REST ([`seed-e2e.mjs`](scripts/seed-e2e.mjs)) → attach the app to both. Skip with `E2E_SKIP_PROVISION=1` (fast re-runs) or `E2E_SKIP_BUILD=1` (reuse `dist/`). Without `YT_TEST_BASE_URL` every spec self-skips ([`playwright.config.ts`](playwright.config.ts)).

**Seeded fixtures** (deterministic, [`scripts/seed-e2e.mjs`](scripts/seed-e2e.mjs) → `artifacts/e2e-env.json`): two app-configured projects, because per-project independence needs a pair —

- **`SCPE1`** ("Capacity One"): **two fully separated teams** (config v4 — every team owns its board, cadence, naming and backlog) — **Alpha** (admin + alice): its own "Capacity One Alpha Board", 14-day Sprints, 8h days, template `Alpha S{sequence}`, backlog = Normal-priority Open issues; **Beta** (bob at 50%): a *different* board, 7-day Sprints, template `Beta S{sequence}`, backlog = Major-priority Open issues. The multi-team scenarios.
- **`SCPE2`** ("Capacity Two"): **one team** (admin + bob) — 7-day Sprints, 6h days, its own board/template; the single-team baseline and independence counterpart.

Seeded boards are created with **project-based sharing** (`ensureBoard` in [`scripts/lib/seed-lib.mjs`](scripts/lib/seed-lib.mjs)) — REST-created boards default to owner-only, which would 403 the member personas' planner reads.

**Personas** ([`fixtures/personas.ts`](tests/e2e/fixtures/personas.ts), storage states materialised by [`auth.setup.ts`](tests/e2e/auth.setup.ts)): `manager` (admin, project leader of both = manager), `alice` (One/Alpha member), `bob` (One/Beta + Two member; also seeded as a non-leader project admin of Two — the granted-`UPDATE_PROJECT` manager case), `eve` (authenticated, **no** project role).

**Capture policy** ([`playwright.config.ts`](playwright.config.ts)): `*.critical.spec.ts` record video/trace/screenshot always; `*.regression.spec.ts` retain on failure only. Reports → `artifacts/playwright-report/`; traces/videos → `artifacts/test-results/`. The [`axe fixture`](tests/e2e/fixtures/axe.ts) fails a test on serious/critical WCAG 2 A/AA violations. Specs verify backend state over REST with the admin token ([`fixtures/rest.ts`](tests/e2e/fixtures/rest.ts)) when it is available.

```bash
npm run test:e2e
npm run test:e2e -- --project=critical        # forward args to Playwright
```

---

## Integration (`tests/youtrack`)

Drives the live REST API of a **local, disposable** YouTrack. The orchestrator [`run-integration.mjs`](scripts/run-integration.mjs) runs *provision → seed → vitest `tests/youtrack` → cleanup* (cleanup always runs in `finally`); provisioning is skipped when `YT_TEST_BASE_URL` + `YT_TEST_ADMIN_TOKEN` already point at an instance. The suite itself self-skips when `YT_TEST_BASE_URL` is unset.

**Safety gates** ([`scripts/lib/yt-env.mjs`](scripts/lib/yt-env.mjs)): `YT_TEST_ALLOW_DESTRUCTIVE` must equal `true`; production-looking base URLs are hard-blocked (only `localhost`/`127.0.0.1`/`[::1]`/`*.local`; `*.youtrack.cloud` and `*.jetbrains.*` always refused). Seeded entities are namespaced by run id (`YT_TEST_PROJECT_PREFIX`, default `SCP_E2E`) and cleaned up in `afterAll`. Environment variables: copy [`.env.example`](.env.example) → `.env` (git-ignored).

```bash
cp .env.example .env    # LOCAL instance + YT_TEST_ALLOW_DESTRUCTIVE=true
npm run test:integration
```

---

## Demo reels (`tests/e2e/demo`)

Three reels — **01-setup** (install & configure), **02-walkthrough** and **03-multi-project** (per-project independence) — recorded **headed under Xvfb inside a Docker recorder image** against the host's real YouTrack ([`scripts/record-demos-docker.mjs`](scripts/record-demos-docker.mjs), config [`playwright.demo.config.ts`](playwright.demo.config.ts)), then voiced on the host (Piper TTS, `say` fallback — [`render-reels.mjs`](scripts/render-reels.mjs)) and QA'd with the demo-video-review analyzer.

Prepared demo data ([`scripts/setup-youtrack-demo.mjs`](scripts/setup-youtrack-demo.mjs) via [`scripts/lib/seed-lib.mjs`](scripts/lib/seed-lib.mjs), which talks to the **current backend API** — `/api/extensionEndpoints/<app>/backend/<endpoint>?project=<KEY>`, `{ok,…}` envelope): two projects — **AppGlass (AGP)** with two fully separated teams: **Platform** (its own "AppGlass Platform Board", 14-day Sprints, Normal-priority backlog, a deliberately over-committed Sprint) and **Mobile** (its *own* board, 7-day Sprints, its own naming and a Major-priority backlog) — and **Orbit CRM (ORB)** with one team on its own cadence (7-day Sprints, 6h days) — proving per-project *and* per-team independence on camera.

```bash
npm run demo:reset          # wipe + reseed the fixed prepared data
npm run demo:record:docker  # record both reels (Docker + Xvfb), voice, QA
npm run demo:publish        # copy the latest reels into docs/media/
```

`npm run demo:provision` does the full one-shot setup (build → pack → install → seed → attach).

---

## CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))

- **`build-and-test`** (every push/PR): `npm ci → lint → typecheck:all → test:unit → test:contract → build → pack`, uploads `dist/sprint-capacity-planner.zip`.
- **`demos`** (push to main + manual dispatch): boots a real YouTrack in Docker ([`ci-youtrack-docker.mjs`](scripts/ci-youtrack-docker.mjs)), provisions the demo state, records the reels under Xvfb, runs the `tests/youtrack` integration suite against the same instance, and publishes the reels as raw `.mp4` assets on the rolling `demos-latest` pre-release.
- **`security-and-review`**: placeholder steps for the security / code-review tooling.
