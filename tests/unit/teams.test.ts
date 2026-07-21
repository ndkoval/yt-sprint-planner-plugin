import { describe, it, expect } from 'vitest';
import {
  effectiveBacklogQuery,
  newTeamId,
  resolveTeam,
  teamById,
  teamMemberLogins,
  teamsOfUser,
} from '../../src/domain/teams/teams.js';
import type { ProjectConfig, Team } from '../../src/shared/types.js';
import { makeParticipant, makeTeam } from '../fixtures/capacity.js';

const ALPHA: Team = makeTeam({
  id: 'team-1',
  name: 'Alpha',
  participants: [makeParticipant('alice'), makeParticipant('dan', { enabled: false })],
});
const BETA: Team = makeTeam({ id: 'team-2', name: 'Beta', participants: [makeParticipant('bob')] });

function config(teams: Team[], backlogQuery = ''): ProjectConfig {
  return {
    version: 3,
    boardId: 'board-1',
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'Sprint {sequence}',
    backlogQuery,
    learningRate: 0.5,
    teams,
  };
}

describe('teamById / resolveTeam', () => {
  it('finds a team by explicit id', () => {
    const cfg = config([ALPHA, BETA]);
    expect(teamById(cfg, 'team-2')).toBe(BETA);
    expect(resolveTeam(cfg, 'team-1')).toBe(ALPHA);
  });

  it('returns null for an unknown explicit id (even on a single-team config)', () => {
    expect(resolveTeam(config([ALPHA]), 'team-99')).toBeNull();
    expect(teamById(config([ALPHA, BETA]), 'team-99')).toBeNull();
  });

  it('resolves an omitted id to the ONLY team of a single-team config', () => {
    expect(resolveTeam(config([ALPHA]), undefined)).toBe(ALPHA);
  });

  it('returns null for an omitted id when several teams make the choice ambiguous', () => {
    expect(resolveTeam(config([ALPHA, BETA]), undefined)).toBeNull();
  });
});

describe('teamsOfUser', () => {
  it('finds every team a login belongs to, regardless of enablement', () => {
    const cfg = config([ALPHA, BETA]);
    expect(teamsOfUser(cfg, 'alice')).toEqual([ALPHA]);
    expect(teamsOfUser(cfg, 'dan')).toEqual([ALPHA]); // disabled member is still a member
    expect(teamsOfUser(cfg, 'bob')).toEqual([BETA]);
  });

  it('returns ALL teams for a shared specialist', () => {
    const shared = makeTeam({
      id: 'team-3',
      name: 'Platform',
      participants: [makeParticipant('alice', { allocation: 0.5 })],
    });
    expect(teamsOfUser(config([ALPHA, BETA, shared]), 'alice')).toEqual([ALPHA, shared]);
  });

  it('returns an empty list for a login outside every team', () => {
    expect(teamsOfUser(config([ALPHA, BETA]), 'zoe')).toEqual([]);
  });
});

describe('teamMemberLogins', () => {
  it('returns every member login, enabled or not (the issue-attribution set)', () => {
    expect([...teamMemberLogins(ALPHA)].sort()).toEqual(['alice', 'dan']);
  });
});

describe('effectiveBacklogQuery', () => {
  it('uses a non-empty team override, trimmed', () => {
    const team = makeTeam({ backlogQuery: '  #Unresolved for: me  ' });
    expect(effectiveBacklogQuery(config([team], 'project-query'), team)).toBe(
      '#Unresolved for: me',
    );
  });

  it('falls back to the project-level query (trimmed) when the override is empty or absent', () => {
    const noOverride = makeTeam({});
    expect(effectiveBacklogQuery(config([noOverride], '  project-query '), noOverride)).toBe(
      'project-query',
    );
    const blankOverride = makeTeam({ backlogQuery: '   ' });
    expect(effectiveBacklogQuery(config([blankOverride], 'project-query'), blankOverride)).toBe(
      'project-query',
    );
  });

  it('returns an empty string (backlog disabled) when neither is set', () => {
    const team = makeTeam({});
    expect(effectiveBacklogQuery(config([team], ''), team)).toBe('');
  });
});

describe('newTeamId', () => {
  it('starts at team-1 for an empty config', () => {
    expect(newTeamId([])).toBe('team-1');
  });

  it('continues the sequence past existing teams', () => {
    expect(newTeamId(['team-1', 'team-2'])).toBe('team-3');
  });

  it('skips ids that are already used', () => {
    expect(newTeamId(['team-2'])).toBe('team-3'); // team-2 is taken
    expect(newTeamId(['team-1', 'team-3'])).toBe('team-4'); // candidate team-3 is taken
  });
});
