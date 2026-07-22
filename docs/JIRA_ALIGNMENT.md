# Jira alignment

Sprint Capacity Planner deliberately mirrors the mental model Scrum teams already
have from Jira, so the concepts transfer with no relearning. This document maps
our terminology and workflow onto Jira's, and records the design decisions that
follow from that mapping.

## Concept mapping

| Jira concept | Our concept | Notes |
| --- | --- | --- |
| Story Points / Original Estimate | **Original Effort** ("Committed") | The commitment made at planning time. Summed across all issues in a Sprint. Configurable custom field (period), per team. |
| Remaining Estimate / time left | **Current Effort** | Work still outstanding. Resolved issues contribute 0 (the work is done). |
| Time Spent / worklogs | *(intentionally omitted)* | We do not track logged work — no worklog surface, no spent-time rollups. Planning is driven by Original vs Current Effort only. |
| Team velocity (points completed per sprint) | **Focus Factor** + **Planned Capacity** | Instead of raw velocity we learn a focus factor (fraction of raw capacity a team actually converts to completed work) and multiply raw capacity by it to get a planning ceiling. Learned independently per team, each with its own learning rate. |
| Sprint capacity / team availability | **Raw Capacity** (per-person Available × team) | Editable per person, defaults derived from working days × hours/day (hours/day is a per-team setting). |
| A Scrum board per team, each with its own sprint cadence | **Team** | Every team owns its whole configuration — board, sprint length, hours/day, naming, backlog query and effort fields — so multi-team projects work the way separate Jira boards per team do. Teams may share a board or run different ones on different cadences. |
| Capacity-vs-commitment warning | **"What fits" banner** + per-person **Load** bar | Committed Original Effort vs Planned Capacity (Sprint) and vs Available (person). |
| Complete Sprint → "move to next sprint / backlog" | **Carry over unfinished issues** | On create-next, optionally move unresolved issues into the *same team's* new Sprint (on that team's board). |
| Sprint Report (completed vs committed, scope change) | **Completed Original Effort** feeding focus-factor calibration | Observed focus factor = completed ÷ raw; smoothed into the next Sprint's factor. |
| Assignee | **Assignee-scoped effort** + **Unassigned** bucket | Per-person load is shown, but work can stay unassigned to preserve project-direction ownership. |

## Workflow mapping

Jira's sprint lifecycle is *plan → start → work → complete*. Ours attaches to the
same native YouTrack Sprints — managed per team, on the team's board and cadence —
and augments each stage:

1. **Plan** — Jira: estimate stories, fill the sprint to velocity. Ours: edit
   per-person Available capacity; the Planned Capacity (raw × learned focus
   factor) is the ceiling; the "what fits" banner and per-person Load bar show
   whether committed Original Effort fits, exactly like Jira's capacity view but
   driven by our learned focus factor instead of a manual velocity number.
2. **Start** — Jira: start sprint. Ours: the Sprint is a native YouTrack Sprint,
   started in YouTrack; we never own the Sprint object.
3. **Work** — Jira: burndown on Remaining Estimate. Ours: Current Effort and
   Remaining Capacity recompute automatically as issues change (no manual
   refresh/recalculate).
4. **Complete** — Jira: Complete Sprint dialog offers to move incomplete issues.
   Ours: **Create next Sprint** computes the next name/dates from the team's own
   cadence and template, creates the Sprint on the team's board, offers **carry
   over unfinished issues** (into that same team's new Sprint), and — this is the
   part Jira does *not* do automatically — calibrates the team's next focus factor
   from its just-completed Sprint's completed-vs-raw ratio.

## Adjustments made for this alignment

- **Terminology.** UI copy uses "Committed" for Original Effort in the capacity
  surfaces (Load column, "what fits" banner) so it reads the way a Jira user
  expects. Field labels remain configurable per team (`originalEffortField` /
  `currentEffortField` live on the team).
- **Carry over unfinished work.** The create-next dialog matches Jira's Complete
  Sprint behaviour: it names the exact count of unresolved issues
  (`unresolvedIssueCount`) and, when opted in, moves them from the team's previous
  Sprint into the same team's new one on that team's board — idempotently: re-running
  create-next resumes an already-created identical Sprint instead of duplicating it.
- **Capacity-vs-committed indicator.** Added the per-person Load bar (committed
  vs available) and the Sprint-level "what fits" banner (committed vs planned),
  the two checks a Jira team makes when filling a sprint.
- **No spent-time / worklogs.** Kept out on purpose: this tool plans and
  calibrates; it does not replace time tracking.

## Deliberately different from Jira

- We **learn** the focus factor from history — per team, with the team's own
  learning rate — instead of asking for a velocity number, and clamp its
  per-Sprint movement, so a single anomalous Sprint does not swing the plan.
- Everything recomputes automatically from the live Sprint contents; there is no
  manual "recalculate" step and no separately committed/locked scope.
