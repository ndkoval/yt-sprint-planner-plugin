import { describe, it, expect } from 'vitest';
import { getSprintData, registerSprint, writeCapacity } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { loadSprintData } from '../../src/backend/storage.js';
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
  it('creates a team entry with sequence 1 and a seeded capacity document', () => {
    const world = seedWorld();
    const { teamId, entry } = registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    expect(teamId).toBe(TEAM_ID); // teamId omitted resolves to the only team
    expect(entry.sequence).toBe(1);
    expect(entry.capacityRevision).toBe(1);
    expect(Object.keys(entry.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    // 10 working days (Mon–Fri across the window) × 8h × 60 = 4800 minutes.
    expect(entry.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(4800);
    expect(entry.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(false);
    expect(entry.focusFactor).toBe(0.75);
    expect(entry.focusFactorSource).toBe('bootstrap');
  });

  it('registers ONLY the targeted team; another team registering the same native Sprint id keeps an independent entry', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const ctx = ctxFor(world, MANAGER.login);
    const alpha = registerSprint(ctx, { teamId: TEAM_ID, sprint: SPRINT });
    // Beta has NO entry until it registers the Sprint itself.
    expect(getSprintData(ctx, TEAM_2_ID).sprints).toEqual({});
    const beta = registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT });
    expect(Object.keys(alpha.entry.capacity.rows)).toEqual([MEMBER.login]);
    expect(Object.keys(beta.entry.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(beta.entry.capacityRevision).toBe(1);
    // Beta's registration left Alpha's stored entry untouched.
    expect(getSprintData(ctx, TEAM_ID).sprints[SPRINT.id]).toEqual(alpha.entry);
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
    expect(Object.keys(entry.capacity.rows)).toEqual([MEMBER.login]);
    expect(entry.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(2400); // 4800 × 0.5
  });

  it('assigns increasing sequences to successive Sprints of one team', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    const second = registerSprint(ctx, {
      sprint: { id: '207-2', name: 'S2', start: '2026-01-19', finish: '2026-02-01' },
    });
    expect(second.entry.sequence).toBe(2);
    expect(Object.keys(getSprintData(ctx, undefined).sprints)).toHaveLength(2);
  });

  it('counts sequences PER TEAM — a second team starts at 1 regardless of the first team', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { teamId: TEAM_ID, sprint: SPRINT });
    registerSprint(ctx, {
      teamId: TEAM_ID,
      sprint: { id: '207-2', name: 'S2', start: '2026-01-19', finish: '2026-02-01' },
    });
    const beta = registerSprint(ctx, {
      teamId: TEAM_2_ID,
      sprint: { id: '208-1', name: 'B1', start: '2026-01-05', finish: '2026-01-11' },
    });
    expect(beta.entry.sequence).toBe(1);
  });

  it('applies the focus-factor seed to the registered team; a team without a seed gets the bootstrap default', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const ctx = ctxFor(world, MANAGER.login);
    const seeded = registerSprint(ctx, {
      teamId: TEAM_ID,
      sprint: SPRINT,
      seed: { focusFactor: 0.6, focusFactorSource: 'calculated' },
    });
    expect(seeded.entry.focusFactor).toBe(0.6);
    expect(seeded.entry.focusFactorSource).toBe('calculated');
    const unseeded = registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT });
    expect(unseeded.entry.focusFactor).toBe(0.75);
    expect(unseeded.entry.focusFactorSource).toBe('bootstrap');
  });
});

describe('registerSprint — existing entry', () => {
  it('re-registering with changed dates recomputes non-customized defaults with the TEAM hoursPerDay and bumps the revision', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    // Extend to a 4-week window (20 working days × 8h × 60 → 9600 minutes).
    const { entry } = registerSprint(ctx, {
      sprint: { ...SPRINT, finish: '2026-02-01' },
    });
    expect(entry.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(9600);
    expect(entry.capacity.rows[MEMBER.login]!.availableMinutes).toBe(9600);
    expect(entry.capacityRevision).toBe(2);
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
    const row = entry.capacity.rows[MEMBER.login]!;
    expect(row.defaultMinutes).toBe(9600);
    expect(row.availableMinutes).toBe(1000); // customized value survives
    expect(row.availableWasCustomized).toBe(true);
  });

  it('does NOT bump the revision when nothing about capacity changed', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    const { entry } = registerSprint(ctx, { sprint: { ...SPRINT, name: 'Renamed' } });
    expect(entry.name).toBe('Renamed');
    expect(entry.capacityRevision).toBe(1);
  });

  it('backfills rows for participants who joined the team after the Sprint was seeded', () => {
    const oneMember = defaultConfig({
      teams: [defaultTeam({ participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
    });
    const world = seedWorld({ config: oneMember });
    const ctx = ctxFor(world, MANAGER.login);
    const first = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(first.entry.capacity.rows)).toEqual([MEMBER.login]);

    storeConfig(world, defaultConfig()); // widen the team back to both members
    const second = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(second.entry.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    expect(second.entry.capacityRevision).toBe(2); // rows added ⇒ capacity changed
  });

  it('a team ADDED to the config registers its own fresh entry for an already-planned native Sprint', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    const original = registerSprint(ctx, { sprint: SPRINT });

    storeConfig(world, twoTeamConfig());
    // The new team is NOT materialized lazily — it has no entry until it registers.
    expect(getSprintData(ctx, TEAM_2_ID).sprints).toEqual({});
    const { entry } = registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT });
    expect(entry.sequence).toBe(1);
    expect(entry.capacityRevision).toBe(1);
    expect(Object.keys(entry.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(entry.focusFactorSource).toBe('bootstrap');
    // The first team's entry is untouched by the other team's registration.
    expect(getSprintData(ctx, TEAM_ID).sprints[SPRINT.id]).toEqual(original.entry);
  });

  it('retains entries of teams removed from the config, untouched (orphans)', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { teamId: TEAM_ID, sprint: SPRINT });
    const orphanBefore = registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT }).entry;

    storeConfig(
      world,
      defaultConfig({
        teams: [defaultTeam({ name: 'Alpha', participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
      }),
    );
    const { entry } = registerSprint(ctx, { sprint: { ...SPRINT, finish: '2026-02-01' } });
    expect(entry.capacityRevision).toBe(2); // the live team did change

    // The removed team can no longer be targeted…
    try {
      registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
    // …but its stored entry is retained, byte-for-byte (not reapplied, not bumped).
    expect(loadSprintData(world.project).teams[TEAM_2_ID]!.sprints[SPRINT.id]).toEqual(orphanBefore);
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

  it('rejects an omitted teamId when the project has several teams', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    try {
      registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects an unknown teamId', () => {
    const world = seedWorld();
    try {
      registerSprint(ctxFor(world, MANAGER.login), { teamId: 'no-such-team', sprint: SPRINT });
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
