/**
 * Team helpers. Teams are small groups planning independently WITHIN a project:
 * all teams share the project's board and Sprint cadence, but each team has its own
 * participants, capacity, Focus Factor calibration and backlog filter.
 *
 * Issue → team attribution derives from the issue's single-value Assignee: an issue
 * belongs to every team its assignee is a MEMBER of (enabled or not — enablement only
 * controls capacity seeding, not membership). A shared specialist may be in several
 * teams; their issues then count toward each of those teams' metrics, while Sprint
 * totals still count every issue exactly once.
 */
import type { ProjectConfig, Team } from '../../shared/types.js';

/** Find a team by id, or null. */
export function teamById(config: ProjectConfig, teamId: string): Team | null {
  return config.teams.find((t) => t.id === teamId) ?? null;
}

/**
 * Resolve which team a request targets. An explicit id wins; without one, a
 * single-team config unambiguously means its only team (keeps single-team callers
 * and older scripts working). Returns null when the id is unknown or the choice is
 * ambiguous — the caller decides how to fail.
 */
export function resolveTeam(config: ProjectConfig, teamId: string | undefined): Team | null {
  if (teamId !== undefined) return teamById(config, teamId);
  return config.teams.length === 1 ? config.teams[0]! : null;
}

/** Every team a user belongs to (by membership, enabled or not). */
export function teamsOfUser(config: ProjectConfig, login: string): Team[] {
  return config.teams.filter((t) => t.participants.some((p) => p.userId === login));
}

/** Logins of a team's members (enabled or not) — the issue-attribution set. */
export function teamMemberLogins(team: Team): ReadonlySet<string> {
  return new Set(team.participants.map((p) => p.userId));
}

/**
 * The backlog search a team's board actually uses: the team's non-empty override,
 * else the project-level query. An empty result disables the backlog lane.
 */
export function effectiveBacklogQuery(config: ProjectConfig, team: Team): string {
  const override = (team.backlogQuery ?? '').trim();
  return override.length > 0 ? override : (config.backlogQuery ?? '').trim();
}

/** Generate the next free team id ("team-N"). Ids are stable and never renamed. */
export function newTeamId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = existingIds.length + 1;
  while (used.has(`team-${n}`)) n += 1;
  return `team-${n}`;
}
