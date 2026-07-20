# Claude Code Tooling

This document records the Claude Code plugins used to build and maintain the Sprint
Capacity Planner app, per §0.2 of the technical specification. Plugins were installed
from the official catalogue with `/plugin install <name>@claude-plugins-official`.

> **Verification note.** Plugin *installation* and *version pinning* are performed by
> the developer in the Claude Code client (`/plugin install …`, then `/plugin` to view
> versions), because the agent cannot install plugins or read the marketplace registry
> itself. The table records what was installed in this environment on 2026-07-16; run
> `/plugin` to confirm exact versions on your machine and update the "Installed version"
> column. Do not continue development if a **required** plugin fails to install.

| Plugin | Installed version | Source | Purpose | Permissions | Configuration | Verification result |
|---|---|---|---|---|---|---|
| `claude-code-setup` | (see `/plugin`) | claude-plugins-official | Analyze repo, recommend hooks/skills/subagents/MCP → `docs/CLAUDE_AUTOMATION_PLAN.md` | Read repo | none | Installed ✓ |
| `feature-dev` | (see `/plugin`) | claude-plugins-official | Primary dev workflow: research → design → implement → review | Read/Write repo | none | Installed ✓ |
| `typescript-lsp` | (see `/plugin`) | claude-plugins-official | go-to-def, find-refs, TS/JS diagnostics for .ts/.tsx/.js/.jsx | Local LSP process | requires `typescript-language-server` + `typescript` installed globally | Installed ✓; LSP server installed globally |
| `context7` | (see `/plugin`) | claude-plugins-official | Version-specific docs/examples (YouTrack Apps/REST/Workflow API, Ring UI, Playwright, TS, test libs) | Network (MCP) | MCP server; needs `/reload-plugins` | Installed ✓ |
| `playwright` | (see `/plugin`) | claude-plugins-official | Browser automation, E2E, screenshots, UI verification | Launches browsers (MCP) | needs `npx playwright install chromium` | Installed ✓ |
| `github` | (see `/plugin`) | claude-plugins-official | Repo/branches/commits/PRs/CI/Actions/reviews/artifacts/issues | GitHub token (MCP) | `gh auth login` | Install pending — verify with `/plugin` |
| `code-review` | (see `/plugin`) | claude-plugins-official | Confidence-scored automated code review after each major stage + before PR | Read repo | none | Installed ✓ |
| `security-guidance` | (see `/plugin`) | claude-plugins-official | Continuous checks: secrets, injection, XSS, SSRF, unsafe handlers, authz, data leaks | Read repo/diff | none | Installed ✓ |
| `frontend-design` | (see `/plugin`) | claude-plugins-official | UI critique: labels, empty/validation states, accessibility; keep native Ring UI look | Read repo | none | Installed ✓ |

## MCP-backed plugins

`context7`, `playwright`, `typescript-lsp`, and `github` expose their capabilities as MCP
tools. Run `/reload-plugins` after installation to activate them in the session. They are
**not** required for the code core (domain/backend/workflows/widgets/tests) to build and
pass `lint` / `typecheck` / `unit` / `contract`.

## Supporting toolchain (non-plugin)

| Tool | Purpose | Install |
|---|---|---|
| Node.js ≥ 20 LTS | Runtime for build/test tooling | system |
| `typescript-language-server`, `typescript` (global) | Required by `typescript-lsp` | `npm i -g typescript-language-server typescript` |
| `ffmpeg` / `ffprobe` | Video/trace analysis, contact sheets (§28) | `brew install ffmpeg` |
| Chromium (Playwright) | E2E browser | `npx playwright install --with-deps chromium` |
| Local YouTrack Server distribution | Real integration tests (no Docker) | downloaded by `scripts/provision-youtrack.mjs` |

> **Known local-tooling gotcha.** A globally-installed `typescript` wrapper can shadow the
> project compiler and fail with `Unable to resolve @typescript/typescript-<platform>`.
> Always invoke the project compiler via `node_modules/.bin/tsc` (which is what the npm
> scripts do), not a global `tsc`.
