# Development guide — Sprint Capacity Planner (YouTrack App)

This is the working guide for developing, testing, and packaging the app. It is the
canonical development doc; `CLAUDE.md` is a symlink to this file so Claude Code picks it up.

## Prerequisites

- Node.js **≥ 20** (`engines.node` in `package.json`).
- For anything touching the real YouTrack (integration/E2E/demos): a running YouTrack
  instance — see the policy below.

## Build & package

```bash
npm ci
npm run build   # -> dist/  (backend, widgets, workflows, manifest, entity-extensions, settings)
npm run pack    # -> dist/sprint-capacity-planner.zip
```

`npm run build` runs `clean → build-backend → build-widgets → copy manifest/entity-extensions/settings/workflows/assets`
(see `scripts/build.mjs`). `npm run pack` zips `dist/` with a pure-Node writer (`scripts/pack.mjs`).
Workflow modules are emitted at the ZIP root.

> **Do not run `npm run build`/`npm run clean` while a demo recording is in flight** — `clean`
> wipes `dist/` **and** `artifacts/`, which removes the recorder's storage state and in-progress reels.

## Tests

| Command | What it runs | Needs a YouTrack instance? |
| --- | --- | --- |
| `npm run test:unit` | Domain unit tests (`tests/unit`) | no |
| `npm run test:contract` | Backend contract tests against the fake `BackendEnv` (`tests/contract`) | no |
| `npm run coverage` | Unit + contract with V8 coverage | no |
| `npm run test:integration` | Provision → seed → run `tests/youtrack` → cleanup | **yes** (local, gated) |
| `npm run test:e2e` | Playwright suite (`tests/e2e`); auto-provisions install + the two seeded projects (SCPE1/SCPE2) when `YT_TEST_BASE_URL` + an admin token are set | **yes** (self-skips otherwise) |
| `npm run test:all` | lint → typecheck:all → unit → contract → build → test:e2e | no (the e2e step self-skips) |

`npm run test:all` is the pre-PR gate. See `TESTING.md` for the full pyramid.

## Demos & reels

Three reels — **install & configure**, **walkthrough** and **per-project independence** — are
recorded headed under a virtual display (Xvfb) inside a Docker image against a **real** YouTrack,
then narrated (Piper TTS, `say` fallback) and QA'd.

```bash
npm run demo:reset          # wipe + seed the fixed prepared data on the real YouTrack
npm run demo:record:docker  # record the reels headed under Xvfb in the recorder image
npm run demo:publish        # copy the latest reels into docs/media/ (what the README links to)
```

## Testing & demos MUST use a real YouTrack (non-negotiable)

- **Every test and every demo must run against a REAL YouTrack instance.** No custom
  boards, no hand-built HTML stubs, no fakes standing in for YouTrack UI. If something
  needs YouTrack's Kanban board, it must be YouTrack's actual board.
- **The Kanban board in demos must be the standard YouTrack board.** Do NOT develop a
  custom board.
- **Hosting real YouTrack (platform-dependent):**
  - The app's **project widgets** (project tab + settings) require YouTrack **2024.3+**
    (`PROJECT_TAB` / `PROJECT_SETTINGS` extension points). On Apple-Silicon the 2024.3+
    standalone build can't boot (GraalVM/Truffle 22), so run it in **Docker** forced to
    `--platform linux/amd64`. Image: `jetbrains/youtrack:2024.3.148430`.
  - The **native YouTrack board** works on the standalone **2024.1.34109** build, which
    boots locally on arm64 with no Docker (bundled mac-x64 JRE under Rosetta). See
    `scripts/provision-youtrack.mjs`.
  - A real remote/Cloud instance is also acceptable.
- If a real YouTrack genuinely cannot be brought up in the current environment, that is a
  **blocker to surface** — not something to paper over with a stub. State the exact obstacle
  and ask how to proceed.
- The in-memory backend fake (`FakeEnv`, over the `BackendEnv` seam) is allowed ONLY for
  fast unit/contract tests of backend logic. It must never be used to fake the
  YouTrack *UI* in demos or E2E.

Rationale: demos/tests must reflect the real product. Stubs misrepresent it and hide
integration breakage.

## Repository docs

- `ARCHITECTURE.md` — layering and module boundaries.
- `DATA_MODEL.md` — persisted shapes (`scp*` extension properties) and `ProjectConfig`.
- `WORKFLOWS.md` — the availability-reminder rule (the app's only workflow).
- `SECURITY.md` — the full permission matrix and logging policy.
- `TESTING.md` — the test pyramid.
- `docs/JIRA_ALIGNMENT.md` — how the model maps onto Jira's sprint concepts.
