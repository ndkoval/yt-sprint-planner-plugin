/**
 * Per-user preferences (the `scpPrefsJson` USER extension property). These handlers
 * take the caller directly — no project scope — and must be forgiving about stored
 * garbage (prefs are a convenience, never a hard failure). savePrefs is a MERGE:
 * each request may touch `lastProjectKey`, one project's last team, or both, and
 * leaves everything else alone.
 */
import { describe, it, expect } from 'vitest';
import { getPrefs, savePrefs } from '../../src/backend/handlers.js';
import { MEMBER, seedWorld, TEAM_ID, TEAM_2_ID } from './setup.js';

const PREFS_PROP = 'scpPrefsJson';

describe('getPrefs', () => {
  it('returns empty prefs when nothing is stored', () => {
    const world = seedWorld();
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
  });

  it('returns empty prefs for malformed stored JSON', () => {
    const world = seedWorld();
    world.env.setUserProperty(MEMBER.login, PREFS_PROP, '{ not valid json');
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
  });

  it('ignores a stored lastProjectKey that is not a string', () => {
    const world = seedWorld();
    world.env.setUserProperty(MEMBER.login, PREFS_PROP, JSON.stringify({ lastProjectKey: 42 }));
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
  });

  it('tolerates junk in lastTeamByProject: keeps only string-valued entries', () => {
    const world = seedWorld();
    world.env.setUserProperty(
      MEMBER.login,
      PREFS_PROP,
      JSON.stringify({ lastTeamByProject: { AGP: 42, OTHER: TEAM_2_ID, NOPE: null } }),
    );
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({
      lastTeamByProject: { OTHER: TEAM_2_ID },
    });
  });

  it('drops a lastTeamByProject that is not an object, or has no valid entries', () => {
    const world = seedWorld();
    world.env.setUserProperty(
      MEMBER.login,
      PREFS_PROP,
      JSON.stringify({ lastTeamByProject: ['team-1'] }),
    );
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
    world.env.setUserProperty(
      MEMBER.login,
      PREFS_PROP,
      JSON.stringify({ lastTeamByProject: { AGP: 1 } }),
    );
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
  });
});

describe('savePrefs', () => {
  it('saves lastProjectKey alone and round-trips it through getPrefs', () => {
    const world = seedWorld();
    const user = world.env.caller(MEMBER.login);
    const saved = savePrefs(user, { lastProjectKey: 'AGP' });
    expect(saved).toEqual({ lastProjectKey: 'AGP' });
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({ lastProjectKey: 'AGP' });
    expect(world.env.getUserProperty(MEMBER.login, PREFS_PROP)).toBe(
      JSON.stringify({ lastProjectKey: 'AGP' }),
    );
  });

  it('saves lastTeam alone without touching lastProjectKey (merge semantics)', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: 'AGP' });
    const saved = savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'AGP', teamId: TEAM_ID },
    });
    expect(saved).toEqual({ lastProjectKey: 'AGP', lastTeamByProject: { AGP: TEAM_ID } });
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({
      lastProjectKey: 'AGP',
      lastTeamByProject: { AGP: TEAM_ID },
    });
  });

  it('saves lastProjectKey and lastTeam together in one call', () => {
    const world = seedWorld();
    const saved = savePrefs(world.env.caller(MEMBER.login), {
      lastProjectKey: 'AGP',
      lastTeam: { projectKey: 'AGP', teamId: TEAM_2_ID },
    });
    expect(saved).toEqual({ lastProjectKey: 'AGP', lastTeamByProject: { AGP: TEAM_2_ID } });
  });

  it('remembers the last team per project and updates only the touched project', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), { lastTeam: { projectKey: 'AGP', teamId: TEAM_ID } });
    savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'OTHER', teamId: TEAM_2_ID },
    });
    const updated = savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'AGP', teamId: TEAM_2_ID },
    });
    expect(updated).toEqual({ lastTeamByProject: { AGP: TEAM_2_ID, OTHER: TEAM_2_ID } });
  });

  it('teamId: null forgets that project entry, keeping other projects', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), { lastTeam: { projectKey: 'AGP', teamId: TEAM_ID } });
    savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'OTHER', teamId: TEAM_2_ID },
    });
    const cleared = savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'AGP', teamId: null },
    });
    expect(cleared).toEqual({ lastTeamByProject: { OTHER: TEAM_2_ID } });
  });

  it('lastProjectKey: null clears only the project key, keeping lastTeamByProject', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), {
      lastProjectKey: 'AGP',
      lastTeam: { projectKey: 'AGP', teamId: TEAM_ID },
    });
    const cleared = savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: null });
    expect(cleared).toEqual({ lastTeamByProject: { AGP: TEAM_ID } });
    expect(world.env.getUserProperty(MEMBER.login, PREFS_PROP)).toBe(
      JSON.stringify({ lastTeamByProject: { AGP: TEAM_ID } }),
    );
  });

  it('removes the stored property entirely once every pref is cleared', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), {
      lastProjectKey: 'AGP',
      lastTeam: { projectKey: 'AGP', teamId: TEAM_ID },
    });
    savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: null });
    const cleared = savePrefs(world.env.caller(MEMBER.login), {
      lastTeam: { projectKey: 'AGP', teamId: null },
    });
    expect(cleared).toEqual({});
    expect(world.env.getUserProperty(MEMBER.login, PREFS_PROP)).toBeNull();
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({});
  });

  it('keeps prefs per user', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: 'AGP' });
    expect(getPrefs(world.env.caller('member2'))).toEqual({});
  });
});
