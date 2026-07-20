# Project rules — Sprint Capacity Planner (YouTrack App)

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
    `--platform linux/amd64` (user approved Docker for this on 2026-07-18). Image:
    `jetbrains/youtrack:2024.3.148430`.
  - The **native YouTrack board** works on the standalone **2024.1.34109** build, which
    boots locally on arm64 with no Docker (bundled mac-x64 JRE under Rosetta). See
    `scripts/provision-youtrack.mjs` and [[real-yt-no-docker]].
  - A real remote/Cloud instance is also acceptable.
- If a real YouTrack genuinely cannot be brought up in the current environment, that is a
  **blocker to surface to the user** — not something to paper over with a stub. State the
  exact obstacle and ask how to proceed.
- The transport-boundary `FakeYouTrack` is allowed ONLY for fast unit/contract tests of
  backend logic. It must never be used to fake the YouTrack *UI* in demos or E2E.

Rationale: the user requires demos/tests to reflect the real product. Stubs misrepresent
it and hide integration breakage.
