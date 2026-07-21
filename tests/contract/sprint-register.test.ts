import { describe, it, expect } from 'vitest';
import { getSprintData, registerSprint, writeCapacity } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import {
  ctxFor,
  defaultConfig,
  defaultTeam,
  MANAGER,
  MEMBER,
  MEMBER_2,
  seedWorld,
  storeConfig,
  TEAM_ID,
  TEAM_2_ID,
  twoTeamConfig,
} from './setup.js';

const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };

describe('registerSprint — new entry', () => {
  it('creates an entry with sequence 1 and one seeded team entry per config team', () => {
    const world = seedWorld();
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    expect(entry.sequence).toBe(1);
    expect(Object.keys(entry.teams)).toEqual([TEAM_ID]);
    const team = entry.teams[TEAM_ID]!;
    expect(team.capacityRevision).toBe(1);
    expect(Object.keys(team.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    // 10 working days (Mon–Fri across the window) × 8h × 60 = 4800 minutes.
    expect(team.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(4800);
    expect(team.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(false);
    expect(team.focusFactor).toBe(0.75);
    expect(team.focusFactorSource).toBe('bootstrap');
  });

  it('seeds every team of a multi-team config independently', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    expect(Object.keys(entry.teams).sort()).toEqual([TEAM_ID, TEAM_2_ID]);
    expect(Object.keys(entry.teams[TEAM_ID]!.capacity.rows)).toEqual([MEMBER.login]);
    expect(Object.keys(entry.teams[TEAM_2_ID]!.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(entry.teams[TEAM_2_ID]!.capacityRevision).toBe(1);
  });

  it('seeds rows only for ENABLED participants and scales defaults by allocation', () => {
    const config = defaultConfig({
      teams: [
        defaultTeam({
          participants: [
            { userId: MEMBER.login, enabled: true, allocation: 0.5 },
            { userId: MEMBER_2.login, enabled: false, allocation: 1 },
          ],
        }),
      ],
    });
    const world = seedWorld({ config });
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    const team = entry.teams[TEAM_ID]!;
    expect(Object.keys(team.capacity.rows)).toEqual([MEMBER.login]);
    expect(team.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(2400); // 4800 × 0.5
  });

  it('assigns increasing sequences to successive Sprints', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    const second = registerSprint(ctx, {
      sprint: { id: '207-2', name: 'S2', start: '2026-01-19', finish: '2026-02-01' },
    });
    expect(second.entry.sequence).toBe(2);
    expect(Object.keys(getSprintData(ctx).sprints)).toHaveLength(2);
  });

  it('applies the per-team focus-factor seed map; absent teams get the bootstrap default', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), {
      sprint: SPRINT,
      teams: { [TEAM_ID]: { focusFactor: 0.6, focusFactorSource: 'calculated' } },
    });
    expect(entry.teams[TEAM_ID]!.focusFactor).toBe(0.6);
    expect(entry.teams[TEAM_ID]!.focusFactorSource).toBe('calculated');
    expect(entry.teams[TEAM_2_ID]!.focusFactor).toBe(0.75);
    expect(entry.teams[TEAM_2_ID]!.focusFactorSource).toBe('bootstrap');
  });
});

describe('registerSprint — existing entry', () => {
  it('re-registering with changed dates recomputes non-customized defaults and bumps the team revision', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    // Extend to a 4-week window (20 working days → 9600 minutes).
    const { entry } = registerSprint(ctx, {
      sprint: { ...SPRINT, finish: '2026-02-01' },
    });
    const team = entry.teams[TEAM_ID]!;
    expect(team.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(9600);
    expect(team.capacity.rows[MEMBER.login]!.availableMinutes).toBe(9600);
    expect(team.capacityRevision).toBe(2);
    expect(entry.sequence).toBe(1); // sequence is stable across re-registration
  });

  it('keeps a customized row available on a date change (only the default moves)', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 1000,
    });
    const { entry } = registerSprint(ctx, { sprint: { ...SPRINT, finish: '2026-02-01' } });
    const row = entry.teams[TEAM_ID]!.capacity.rows[MEMBER.login]!;
    expect(row.defaultMinutes).toBe(9600);
    expect(row.availableMinutes).toBe(1000); // customized value survives
    expect(row.availableWasCustomized).toBe(true);
  });

  it('does NOT bump the team revision when nothing about capacity changed', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    const { entry } = registerSprint(ctx, { sprint: { ...SPRINT, name: 'Renamed' } });
    expect(entry.name).toBe('Renamed');
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(1);
  });

  it('backfills rows for participants who joined the team after the Sprint was seeded', () => {
    const oneMember = defaultConfig({
      teams: [defaultTeam({ participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
    });
    const world = seedWorld({ config: oneMember });
    const ctx = ctxFor(world, MANAGER.login);
    const first = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(first.entry.teams[TEAM_ID]!.capacity.rows)).toEqual([MEMBER.login]);

    storeConfig(world, defaultConfig()); // widen the team back to both members
    const second = registerSprint(ctx, { sprint: SPRINT });
    const team = second.entry.teams[TEAM_ID]!;
    expect(Object.keys(team.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    expect(team.capacityRevision).toBe(2); // rows added ⇒ capacity changed
  });

  it('seeds config teams missing from the entry (added after registration) at revision 1', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });

    storeConfig(world, twoTeamConfig());
    const { entry } = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(entry.teams).sort()).toEqual([TEAM_ID, TEAM_2_ID]);
    const added = entry.teams[TEAM_2_ID]!;
    expect(added.capacityRevision).toBe(1);
    expect(Object.keys(added.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(added.focusFactorSource).toBe('bootstrap');
  });

  it('retains entries of teams removed from the config, untouched (orphans)', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const ctx = ctxFor(world, MANAGER.login);
    const first = registerSprint(ctx, { sprint: SPRINT });
    const orphanBefore = first.entry.teams[TEAM_2_ID]!;

    storeConfig(
      world,
      defaultConfig({
        teams: [defaultTeam({ name: 'Alpha', participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
      }),
    );
    const { entry } = registerSprint(ctx, { sprint: { ...SPRINT, finish: '2026-02-01' } });
    expect(entry.teams[TEAM_2_ID]).toEqual(orphanBefore); // not reapplied, not bumped
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(2); // the live team did change
  });
});

describe('registerSprint — validation & authorization', () => {
  it('rejects a non-manager with FORBIDDEN', () => {
    const world = seedWorld();
    try {
      registerSprint(ctxFor(world, MEMBER.login), { sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a finish that is not after start', () => {
    const world = seedWorld();
    try {
      registerSprint(ctxFor(world, MANAGER.login), {
        sprint: { ...SPRINT, finish: SPRINT.start },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('throws NOT_CONFIGURED when no config exists', () => {
    const world = seedWorld({ configured: false });
    try {
      registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_CONFIGURED');
    }
  });
});
