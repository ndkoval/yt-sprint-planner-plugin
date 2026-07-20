# Claude Code Automation Plan

Generated with the `claude-code-setup` automation-recommender framework (§0.1), tailored
to this repository. Recommendations are advisory; implement the ones that fit your team.

## Codebase profile

- **Type**: TypeScript monorepo-in-one-package (ESM), Node ≥ 20.
- **Runtime targets**: YouTrack App backend (HTTP handler), YouTrack Workflow JS
  (ES2019 CommonJS), and React 18 + Ring UI widgets.
- **Key libraries**: `zod` (runtime validation), `@jetbrains/ring-ui-built`, `react`,
  `esbuild` (bundling), `vitest` (unit/contract), `@playwright/test` + `@axe-core/playwright` (E2E/a11y).
- **Structure**: `src/domain` (pure calc), `src/backend` (handlers/services/repositories),
  `src/workflows` (YT rules), `src/widgets` (UI); `tests/{unit,contract,integration,youtrack,e2e}`.
- **Correctness-critical core**: `src/domain/**` (capacity/effort/focus-factor math) — held to 95% coverage.

---

## 🔌 MCP Servers

### context7 (installed)
**Why**: The app targets fast-moving, version-specific APIs (YouTrack Apps/REST/Workflow,
Ring UI) where guessing is costly. Use it before writing any SDK-boundary code — every
`// SPIKE` marker in `src/backend/repositories/youtrack-http-client.ts` and `src/workflows`
is a place to confirm the real API shape via context7.
**Activate**: `/reload-plugins`.

### Playwright (installed)
**Why**: `tests/e2e` drives the real widgets in a YouTrack. Use the Playwright MCP to
explore the actual embedded-widget DOM and replace the best-effort selectors marked
`// SPIKE` in the E2E specs with verified ones.

---

## 🎯 Skills

### `youtrack-app-development` (project-local — created, `.claude/skills/`)
**Why**: Centralises confirmed YouTrack App structure, extension points, REST vs Workflow
API limits, Ring UI conventions, packaging/installation, and migrations so every agent
follows the same verified rules. Invocation: **both**.

### `youtrack-testing` (project-local — created)
**Why**: Encodes the no-Docker local-instance provisioning, isolation naming, cleanup and
safety guards so integration runs are reproducible and never touch production. Invocation: **both**.

---

## ⚡ Hooks

### PostToolUse: typecheck + lint the touched scope
**Why**: `strict` TS with `exactOptionalPropertyTypes` + `no-explicit-any` catches most
defects at edit time. A hook running `node_modules/.bin/tsc -p tsconfig.json --noEmit` (or
`tsconfig.widgets.json` for `src/widgets`) and `eslint <file>` after `Edit`/`Write` on
`src/**/*.ts(x)` keeps the tree green between agents.
**Where**: `.claude/settings.json` → `hooks.PostToolUse`. (Use `node_modules/.bin/tsc`, not global `tsc`.)

### PreToolUse: block edits to secrets / lock files
**Why**: The repo forbids committing tokens (§32). Block `Edit`/`Write` on `.env`,
`.env.*` (except `.env.example`), `*.token`, and `package-lock.json`.

---

## 🤖 Subagents

### `security-reviewer`
**Why**: The backend authorises every mutation server-side (§16) and sanitises logs (§19).
A dedicated reviewer that audits new handlers for missing authz checks, unsanitised logging,
SSRF in the REST client, and secret handling pairs well with the installed `security-guidance`
plugin. Run it after each backend change.

### `code-reviewer`
**Why**: Multi-runtime codebase (backend/workflow/widget) benefits from a parallel reviewer
focused on the domain invariants: minutes-as-unit, no premature rounding, resolved⇒current 0,
native Sprint as sole source of truth, and idempotent migrations. Pairs with the `code-review` plugin.

---

## 🔌 Plugins (already installed — see docs/CLAUDE_TOOLING.md)

`feature-dev`, `code-review`, `security-guidance`, `frontend-design`, `typescript-lsp`,
`context7`, `playwright`, `github`, `claude-code-setup`.

---

**Want more?** Ask for additional recommendations for any category (e.g. "more hooks" or
"MCP options for the local YouTrack harness").
