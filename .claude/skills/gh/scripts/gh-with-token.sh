#!/usr/bin/env bash
#
# Run `gh` authenticated with the GH_YT_SPRINT_PLANNER_TOKEN personal access token.
#
# `gh` reads GH_TOKEN for non-interactive auth, so we map the project PAT onto it. The token
# is passed only through the environment (never argv) and is never printed. Usage:
#   .claude/skills/gh/scripts/gh-with-token.sh <gh args...>
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is not installed. Install it: https://cli.github.com/" >&2
  exit 127
fi

if [ -z "${GH_YT_SPRINT_PLANNER_TOKEN:-}" ]; then
  {
    echo "GH_YT_SPRINT_PLANNER_TOKEN is not set — cannot authenticate gh."
    echo "Export your GitHub PAT into it for this session, e.g. in the Claude Code prompt:"
    echo "  ! export GH_YT_SPRINT_PLANNER_TOKEN=<your-token>"
  } >&2
  exit 1
fi

# GH_PAGER=cat so output never blocks on a pager in non-interactive use.
exec env GH_TOKEN="$GH_YT_SPRINT_PLANNER_TOKEN" GH_PAGER=cat gh "$@"
