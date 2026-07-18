# Project rules — Sprint Capacity Planner (YouTrack App)

## Testing & demos MUST use a real YouTrack (non-negotiable)

- **Every test and every demo must run against a REAL YouTrack instance.** No custom
  boards, no hand-built HTML stubs, no fakes standing in for YouTrack UI. If something
  needs YouTrack's Kanban board, it must be YouTrack's actual board.
- **The Kanban board in demos must be the standard YouTrack board.** Do NOT develop a
  custom board.
- **No Docker.** Launch a real, local YouTrack instance directly on the host (download a
  pinned distribution, unpack, run its launcher), or point tests at a real remote/Cloud
  instance. See `scripts/provision-real-youtrack.mjs` and [[real-yt-no-docker]].
- If a real YouTrack genuinely cannot be brought up in the current environment, that is a
  **blocker to surface to the user** — not something to paper over with a stub. State the
  exact obstacle and ask how to proceed.
- The transport-boundary `FakeYouTrack` is allowed ONLY for fast unit/contract tests of
  backend logic. It must never be used to fake the YouTrack *UI* in demos or E2E.

Rationale: the user requires demos/tests to reflect the real product. Stubs misrepresent
it and hide integration breakage.
