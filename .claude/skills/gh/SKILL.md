---
name: gh
description: Run GitHub CLI (gh) and GitHub API operations for this repo (ndkoval/yt-sprint-planner-plugin) authenticated with the GH_YT_SPRINT_PLANNER_TOKEN personal access token. Use for ANY gh command or GitHub REST/GraphQL call — PRs, issues, releases + release-asset uploads, workflow/Actions runs, repo settings — so no interactive `gh auth login` is needed. Invoke whenever a task needs GitHub access.
---

# gh — authenticated GitHub CLI for this repo

All GitHub access for `ndkoval/yt-sprint-planner-plugin` authenticates with a personal
access token (PAT) supplied via the **`GH_YT_SPRINT_PLANNER_TOKEN`** environment variable.
`gh` itself reads `GH_TOKEN`, so this skill bridges the two — never run a bare `gh auth login`.

## How to run gh

Prefer the wrapper (it injects the token, disables the pager, and never echoes the secret):

```bash
.claude/skills/gh/scripts/gh-with-token.sh <gh args...>
```

Examples:

```bash
# Who am I / is auth working?
.claude/skills/gh/scripts/gh-with-token.sh auth status
.claude/skills/gh/scripts/gh-with-token.sh api user -q .login

# Pull requests
.claude/skills/gh/scripts/gh-with-token.sh pr list
.claude/skills/gh/scripts/gh-with-token.sh pr create --fill --base main --head my-branch

# Issues
.claude/skills/gh/scripts/gh-with-token.sh issue list --limit 20

# Releases + assets (e.g. the packed app ZIP)
.claude/skills/gh/scripts/gh-with-token.sh release create v0.1.0 dist/sprint-capacity-planner.zip \
  --title "v0.1.0" --notes-file CHANGELOG.md

# Raw REST/GraphQL
.claude/skills/gh/scripts/gh-with-token.sh api repos/ndkoval/yt-sprint-planner-plugin
```

Equivalent one-off without the wrapper (same idea — map the PAT onto `GH_TOKEN`):

```bash
GH_TOKEN="$GH_YT_SPRINT_PLANNER_TOKEN" GH_PAGER=cat gh <args...>
```

## Rules

- **Never print, echo, log, or paste the token.** Don't `echo "$GH_YT_SPRINT_PLANNER_TOKEN"`
  or pass it on a visible command line other than mapping it to `GH_TOKEN` as shown. The
  wrapper keeps it out of argv.
- If `GH_YT_SPRINT_PLANNER_TOKEN` is unset, the wrapper exits with a clear message — ask the
  user to `export GH_YT_SPRINT_PLANNER_TOKEN=<pat>` in the session (e.g. type
  `! export GH_YT_SPRINT_PLANNER_TOKEN=...`). Do not fall back to `gh auth login`.
- **Outward-facing/irreversible actions** — creating or merging PRs, publishing releases,
  deleting branches, changing repo settings — follow the usual rule: confirm with the user
  first unless they've explicitly authorized that action. Read-only calls (list/view/api GET)
  need no confirmation.
- Default repo is `ndkoval/yt-sprint-planner-plugin`; pass `--repo` to target another.
- The token is a secret credential — treat it like one; it is not committed to the repo.
