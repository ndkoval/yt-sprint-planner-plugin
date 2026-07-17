# Security

Security posture for the Sprint Capacity Planner. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the error envelope and transport boundary.

---

## Server-side authorization on every mutation

Frontend visibility is **never** authorization. Every mutating route in [`src/backend/app.ts`](src/backend/app.ts) resolves the caller's `Principal` server-side ([`src/backend/context.ts`](src/backend/context.ts)) and calls the pure decision functions in [`src/domain/permissions/permissions.ts`](src/domain/permissions/permissions.ts) *before* touching state. Manager role = membership in the group named by the Project property `scpCapacityManagers`, resolved via `isUserInGroup`. When no managers group is configured, **no one** is a manager.

### Permission matrix

| Action | Route | Rule |
| --- | --- | --- |
| Read Sprint / capacity / metrics | `GET /sprints*` | any authenticated user (`canReadSprint`) |
| Edit **own** capacity row / confirm / reset | `PATCH /sprints/:id/capacity/me`, `.../:userId` (self) | `canEditCapacityRow` — self only |
| Edit **any** capacity row | `PATCH /sprints/:id/capacity/:userId` | manager (`canEditCapacityRow` with `isManager`) |
| Edit settings / import | `PUT /config`, `POST /import` | manager (`canEditSettings`) |
| Override Focus Factor | `POST /sprints/:id/focus-factor/override` | manager (`canOverrideFocusFactor`) |
| Include/exclude calibration | `POST /sprints/:id/calibration/*` | manager (`canChangeCalibration`) |
| Recalculate | `POST /sprints/:id/recalculate` | manager (`canRecalculate`) |
| Diagnostics / export | `GET /diagnostics`, `GET /export` | manager (`canReadDiagnostics`) |
| Create / edit native Sprint | `POST /sprints/create-next`, `PATCH /sprints/:id/details` | manager **and** real **Board permission** (`canCreateSprint(principal, hasBoardPermission)`) |

Board-permission failures raise `BOARD_PERMISSION_REQUIRED` (403); role failures raise `FORBIDDEN` (403). The Board permission is resolved at the transport boundary (`canManageBoard`) — see the SPIKE note below.

---

## Sanitized logging

[`src/backend/diagnostics/logger.ts`](src/backend/diagnostics/logger.ts) emits structured JSON lines that carry a **correlation id** and safe context only. `sanitizeContext` deeply redacts a case-insensitive `REDACT_KEYS` set:

```
token · authorization · cookie · password · secret · apikey · api_key · description
```

so tokens, cookies, passwords, and **full issue descriptions** are never logged. Workflows apply the same principle: `sanitizeError` ([`workflow-common.js`](src/workflows/workflow-common.js)) collapses errors to a single safe line and redacts long token-like runs, bearer/authorization fragments, and email addresses before storing to `scpWorkflowError`. Backend errors returned to clients (`toApiError` in [`src/backend/errors.ts`](src/backend/errors.ts)) **never expose stack traces**; every response carries the correlation id for support correlation.

---

## Secrets & tokens

- **No tokens in the repo.** [`.gitignore`](.gitignore) blocks `.env`, `.env.*` (except `.env.example`), and `*.token`. Only [`.env.example`](.env.example) — with empty values — is committed.
- **Minimum-permission test tokens.** The real-YouTrack harness uses a permanent admin token for bootstrap and separate persona logins (manager/alice/bob) so authorization is exercised at the least privilege needed; the `unauthorized` persona verifies denials.
- **Never run destructive tests against production.** [`scripts/lib/yt-env.mjs`](scripts/lib/yt-env.mjs) enforces a two-part gate: `assertDestructiveAllowed` (`YT_TEST_ALLOW_DESTRUCTIVE` must equal `true`) and `assertNotProduction` (only `localhost`/`127.0.0.1`/`[::1]`/`*.local`; `*.youtrack.cloud` / `*.jetbrains.*` always blocked). See [`TESTING.md`](TESTING.md).

---

## Input validation at the boundary

Every mutating request body is validated with **zod** *before* any state change:

- Request schemas: [`src/shared/api-schemas.ts`](src/shared/api-schemas.ts) (`putConfigRequestSchema`, `patchCapacityRequestSchema`, `createNextSprintRequestSchema`, `patchSprintDetailsRequestSchema`, `overrideFocusFactorRequestSchema`, `excludeCalibrationRequestSchema`).
- Document schemas: [`src/shared/schemas.ts`](src/shared/schemas.ts) (all `.strict()`, so unknown keys are rejected).

A `ZodError` is mapped to **HTTP 400 `VALIDATION_FAILED`** with a sanitized `{ path, message }` problem list (no raw payloads echoed). Config is additionally validated against **live** YouTrack state (board exists / uses Sprints / includes the project; effort fields exist, are attached, and are `period`-typed) in [`ConfigService.validate`](src/backend/services/config-service.ts).

---

## Dependencies

Runtime dependencies are minimal (`zod` only; see [`package.json`](package.json)); everything else is dev-only. Before release, run a dependency audit and generate an SBOM:

```bash
npm audit --omit=dev          # runtime advisory scan
npm sbom --sbom-format cyclonedx > artifacts/sbom.cdx.json   # SBOM (npm >= 10)
```

> The CI `security-and-review` job currently has **placeholder** steps for these; wire them to the real tooling before production.

---

## Plugin references

This project's Claude Code tooling (see [`docs/CLAUDE_TOOLING.md`](docs/CLAUDE_TOOLING.md) and [`docs/CLAUDE_AUTOMATION_PLAN.md`](docs/CLAUDE_AUTOMATION_PLAN.md)) pairs with:

- **`security-guidance`** — continuous checks for secrets, injection, XSS, SSRF, unsafe handlers, authorization gaps, and data leaks (especially relevant to the REST client and workflow SDK surface).
- **`code-review`** — confidence-scored automated review after each major stage and before PRs, focused on the invariants (server-side authz, native-Sprint-as-source-of-truth, idempotent migrations).

---

## Known security-relevant SPIKEs

- **`canManageBoard`** ([`youtrack-http-client.ts`](src/backend/repositories/youtrack-http-client.ts)) currently returns "the board is readable" as a placeholder — it does **not** yet verify the caller's real sprint create/update permission. Until wired, `BOARD_PERMISSION_REQUIRED` is effectively never raised against a real instance. This must be corrected before production.
- **Extension-property read/write** is stubbed in the real HTTP client (reads return `null`, writes no-op), so the real backend does not yet persist — verify the SDK storage surface before relying on server-side state.
