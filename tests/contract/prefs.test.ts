/**
 * Per-user preferences (the `scpPrefsJson` USER extension property). These handlers
 * take the caller directly — no project scope — and must be forgiving about stored
 * garbage (prefs are a convenience, never a hard failure).
 */
import { describe, it, expect } from 'vitest';
import { getPrefs, savePrefs } from '../../src/backend/handlers.js';
import { MEMBER, seedWorld } from './setup.js';

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
});

describe('savePrefs', () => {
  it('saves lastProjectKey and round-trips it through getPrefs', () => {
    const world = seedWorld();
    const user = world.env.caller(MEMBER.login);
    const saved = savePrefs(user, { lastProjectKey: 'AGP' });
    expect(saved).toEqual({ lastProjectKey: 'AGP' });
    expect(getPrefs(world.env.caller(MEMBER.login))).toEqual({ lastProjectKey: 'AGP' });
    expect(world.env.getUserProperty(MEMBER.login, PREFS_PROP)).toBe(
      JSON.stringify({ lastProjectKey: 'AGP' }),
    );
  });

  it('clears the stored property when lastProjectKey is null', () => {
    const world = seedWorld();
    savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: 'AGP' });
    const cleared = savePrefs(world.env.caller(MEMBER.login), { lastProjectKey: null });
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
