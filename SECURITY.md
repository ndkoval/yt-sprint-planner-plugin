# Security

Security posture for the Sprint Capacity Planner. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the layering and [`DATA_MODEL.md`](DATA_MODEL.md) for what is stored.

---

## Two enforcement paths, no tokens

- **App-owned state** (config, capacity, focus factor, calibration, export/import) is served by the in-process backend ([`src/backend/index.ts`](src/backend/index.ts)). The caller is `ctx.currentUser` — the real authenticated user — so authorization is always **server-side**; widget-side checks are never trusted. No stored tokens, no REST-to-self.
- **Native YouTrack data** (boards, sprints, issues, users, fields) is read and written by the widget through `host.fetchYouTrack` in the **current user's own REST session** ([`src/widgets/youtrack-client.ts`](src/widgets/youtrack-client.ts)), so YouTrack itself enforces the caller's real board/issue permissions. The app never widens access: creating/editing a native Sprint or assigning an issue requires the caller's own permission, on top of the app's manager role. Operational note: boards created over **REST default to owner-only sharing** — grant project-based sharing (`readSharingSettings`/`updateSharingSettings` `projectBased: true`) or every member's planner reads 403 on the board; our seeds do this (`ensureBoard` in [`scripts/lib/seed-lib.mjs`](scripts/lib/seed-lib.mjs)).

## Who is a manager

The app has **no permission scheme of its own**. A caller is a **manager** iff they are the **project leader** *or* they hold YouTrack's own **`UPDATE_PROJECT`** permission on the project — exactly the right YouTrack gates the project-settings pages on, so app management aligns with "who can change this project's settings in YouTrack". The check runs **server-side on every mutation**: `callerOf` ([`src/backend/index.ts`](src/backend/index.ts)) wraps `ctx.currentUser.hasPermission('UPDATE_PROJECT', project)` as `BackendUser.canUpdateProject` ([`src/backend/env.ts`](src/backend/env.ts)), consumed by `resolvePrincipal` ([`src/backend/handlers.ts`](src/backend/handlers.ts)); the leader is included as a bootstrap. **Managers manage ALL teams** — team membership grants no extra rights and imposes no restriction on managers.

## Permission matrix

Manager = project leader or `UPDATE_PROJECT` holder (above), resolved per request. Decision functions are pure ([`src/domain/permissions/permissions.ts`](src/domain/permissions/permissions.ts)); every mutating handler calls them before touching state. All project endpoints take the project key via `?project=`; the two `prefs` endpoints are project-independent.

| Endpoint | Rule |
| --- | --- |
| `GET prefs` / `POST prefs` | any authenticated user — reads/writes only the **caller's own** `scpPrefsJson` User property (self-scoped; no project parameter, no project resolution) |
| `GET config` | any authenticated user (returns `isManager` / `isProjectLeader` for UI hints only) |
| `POST config` | manager (`canEditSettings`) |
| `GET sprint-data` | any authenticated user (`canReadSprint`) — returns **one team's** sprint map (`?team=`, resolved like any team-scoped request) |
| `POST sprint-register` | manager (`canCreateSprint`) — team-scoped (`{teamId?, sprint, seed?}` upserts the **addressed team's** entry only), plus the caller's own board permission for the native create/edit that precedes it |
| `POST capacity` | own row: any member (`target: 'me'` resolves server-side); **any** row in **any** team: manager (`canEditCapacityRow`) |
| `POST capacity-reset` | own row, or any row for a manager |
| `POST focus-factor` | manager (`canOverrideFocusFactor`) |
| `POST calibration` | manager (`canChangeCalibration`) |
| `GET export` / `POST import` | manager (`canImportExport`) |
| `GET diagnostics` | manager (`canReadDiagnostics`) |

A member's capacity write targets are further constrained by the data: rows exist only for a team's **enabled participants**, and a first-edit row is seeded only when the target is an enabled member of the addressed team — non-members get `NOT_FOUND`, not a row.

**Platform note (member entry points):** through YouTrack **2025.x** the project-settings page also rendered for team members (the widget showed the planner read-only); since **2026.1** YouTrack serves project-settings pages to project admins only, so members use the global **Sprint Capacity Planner** menu item (`MAIN_MENU_ITEM` — same widget, an in-widget project picker). Server-side authorization is identical on either path.

## Transport envelope & error codes

Every backend response travels in an HTTP-**200** envelope `{ok: true, data} | {ok: false, error}` ([`BackendEnvelope`](src/shared/api.ts)) because the host's `fetchApp` transport does not surface HTTP error bodies reliably (verified on YouTrack 2025.3). A failed request carries a structured `ApiError`:

```json
{ "code": "...", "message": "...", "details": {}, "correlationId": "..." }
```

HTTP-equivalent statuses are kept per code for log readability and client parity ([`src/backend/errors.ts`](src/backend/errors.ts), mirrored in [`src/widgets/api-client.ts`](src/widgets/api-client.ts)):

| Code | Status-equivalent |
| --- | --- |
| `VALIDATION_FAILED` | 400 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `NOT_CONFIGURED`, `CAPACITY_REVISION_CONFLICT`, `CONFIG_REVISION_CONFLICT`, `SPRINT_ALREADY_EXISTS` | 409 |
| `INTERNAL_ERROR` | 500 |

The revision-conflict codes guard **same-team** races via per-team `capacityRevision`; teams write **disjoint subtrees** (`teams[teamId].sprints`) of the *same* extension property, so overlapping writes by different teams are not a conflict the platform can detect (extension-property writes are last-write-wins, no compare-and-set) and are converged by the client's verified-write loop (`writeCapacityVerified` in [`src/widgets/api-client.ts`](src/widgets/api-client.ts)) — see [`DATA_MODEL.md`](DATA_MODEL.md) → *Scale & concurrency*.

## Logging

The backend emits **one sanitized `console.error` line per failed request** — `` scp backend [<correlationId>] <CODE>: <message> `` ([`src/backend/index.ts`](src/backend/index.ts)). No request payloads, no issue content, and **never a stack trace** — `toApiError` collapses unknown errors to `INTERNAL_ERROR` with an empty `details`. The `correlationId` (generated per request, [`src/backend/ids.ts`](src/backend/ids.ts)) is returned in the envelope so a user-visible error can be matched to the log line. The workflow follows the same rule: reminders never block, and a failure is one `console.error` line.

## Input validation at the boundary

Every mutating request body is validated with **zod** before any state change: request schemas in [`src/shared/api-schemas.ts`](src/shared/api-schemas.ts) (`putConfigRequestSchema`, `registerSprintRequestSchema`, `capacityWriteRequestSchema`, `capacityResetRequestSchema`, `overrideFocusFactorRequestSchema`, `setCalibrationRequestSchema`, `importRequestSchema`); document schemas in [`src/shared/schemas.ts`](src/shared/schemas.ts) (all `.strict()`). A `ZodError` becomes `VALIDATION_FAILED` with a sanitized `{path, message}` problem list — raw payloads are never echoed. Team-scoped requests (including the `team` query parameter of `GET sprint-data`) resolve their target team server-side: an unknown `teamId`, or an omitted one in a multi-team project, is `VALIDATION_FAILED` (never a silent default).

Persisted documents are also validated **on read** (migrate-then-parse in [`src/backend/storage.ts`](src/backend/storage.ts)); anything unreadable is treated as absent rather than half-trusted.

## Secrets & tokens

- **No tokens in the repo.** [`.gitignore`](.gitignore) blocks `.env`, `.env.*` (except `.env.example`), and `*.token`. Only [`.env.example`](.env.example) — with empty values — is committed.
- **Test tokens stay out of the app.** The e2e/demo harness uses an admin token (env var or `/tmp/yt25-token.txt`) for provisioning and REST assertions, plus separate persona logins (manager/alice/bob/eve) so authorization is exercised at the least privilege needed. The shipped app itself holds **no** credentials.
- **Never run destructive scripts against production.** [`scripts/lib/yt-env.mjs`](scripts/lib/yt-env.mjs) enforces a two-part gate: `assertDestructiveAllowed` (`YT_TEST_ALLOW_DESTRUCTIVE` must equal `true`) and `assertNotProduction` (only `localhost`/`127.0.0.1`/`[::1]`/`*.local`; `*.youtrack.cloud` / `*.jetbrains.*` always blocked; `YT_TEST_ALLOW_NONLOCAL` is an undocumented escape hatch for disposable CI only). See [`TESTING.md`](TESTING.md).

## Dependencies

Runtime dependencies are minimal (`zod` only, bundled into `backend.js`; see [`package.json`](package.json)); everything else is dev-only. Before release, run a dependency audit and generate an SBOM:

```bash
npm audit --omit=dev          # runtime advisory scan
npm sbom --sbom-format cyclonedx > artifacts/sbom.cdx.json   # SBOM (npm >= 10)
```

> The CI `security-and-review` job currently has **placeholder** steps for these; wire them to the real tooling before production.
