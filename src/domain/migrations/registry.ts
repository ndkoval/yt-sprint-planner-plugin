/**
 * Migration registries for each versioned document (§20.1). Every persisted JSON
 * document declares a `version`; when the app reads a document, it runs the matching
 * registry up to the current version via {@link ./migrations.ts}.
 *
 * v2 was the first schema of the project-scoped storage model (login-keyed capacity
 * rows, one flat participants list, one capacity/focus-factor per Sprint). v3 adds
 * TEAMS: the config's participants move into `teams[]`, and each Sprint entry's
 * planning state (capacity, focus factor, calibration) moves under `teams[teamId]`.
 * The migration wraps existing v2 data into a single default team
 * ({@link DEFAULT_TEAM_ID} / "Team 1"), so upgraded projects behave exactly as before.
 *
 * v4 SEPARATES the teams completely: every project-level planning setting (board,
 * effort fields, cadence, naming, backlog, learning rate, reminder lead) moves INTO
 * each team, and Sprint data is re-keyed team-first
 * (`sprints[sprintId].teams[teamId]` → `teams[teamId].sprints[sprintId]`) because
 * teams may now plan on different boards with different cadences. The config
 * migration copies the shared settings into every team (a team's own backlogQuery
 * override, when set, wins over the project-level query), so upgraded projects
 * behave exactly as before until someone edits a team.
 *
 * v1 documents were keyed by REST database ids, which cannot be mapped to logins
 * offline, so v1 has no upgrade path: readers treat v1 documents as absent (the app
 * was pre-release). New schema versions add one sequential {@link Migration} each
 * (fromVersion N → N+1) and bump the CURRENT_* constant. Migrations must preserve
 * unknown fields and be idempotent.
 */
import { DEFAULT_TEAM_ID } from '../../shared/types.js';
import type { Migration, Versioned } from './migrations.js';

export const CURRENT_CAPACITY_VERSION = 2;
export const CURRENT_CONFIG_VERSION = 4;
export const CURRENT_SPRINT_DATA_VERSION = 4;

/** Name the migrated default team gets ("Team 1" matches what "Add team" generates). */
export const DEFAULT_TEAM_NAME = 'Team 1';

/**
 * The pre-v0.3 shipped default name template carried the demo brand ("AppGlass").
 * That literal was never user intent, so the config migration rewrites it to the
 * current generic default; any other value is left untouched.
 */
const LEGACY_DEFAULT_NAME_TEMPLATE = 'AppGlass {year}-S{sequence}';
export const DEFAULT_NAME_TEMPLATE = 'Sprint {sequence}';

/** Capacity document migrations (v2 is current; nested docs did not change in v3). */
export const capacityMigrations: readonly Migration<Versioned>[] = [];

/** Project config (scpConfigJson) migrations. */
export const configMigrations: readonly Migration<Versioned>[] = [
  {
    fromVersion: 2,
    up: (doc) => {
      const config = (doc.config ?? {}) as Versioned & {
        participants?: unknown;
        nameTemplate?: unknown;
        managersGroup?: unknown;
      };
      // managersGroup is dropped: v3 managers are exactly the users with YouTrack's
      // UPDATE_PROJECT permission (checked server-side) — no app permission scheme.
      const { participants, managersGroup: _managersGroup, ...rest } = config;
      return {
        ...doc,
        version: 3,
        config: {
          ...rest,
          version: 3,
          nameTemplate:
            config.nameTemplate === LEGACY_DEFAULT_NAME_TEMPLATE
              ? DEFAULT_NAME_TEMPLATE
              : config.nameTemplate,
          teams: [
            {
              id: DEFAULT_TEAM_ID,
              name: DEFAULT_TEAM_NAME,
              participants: participants ?? [],
            },
          ],
        },
      };
    },
  },
  {
    fromVersion: 3,
    up: (doc) => {
      const config = (doc.config ?? {}) as Versioned & {
        teams?: unknown;
        boardId?: unknown;
        originalEffortField?: unknown;
        currentEffortField?: unknown;
        hoursPerDay?: unknown;
        sprintLengthDays?: unknown;
        datePolicy?: unknown;
        nameTemplate?: unknown;
        backlogQuery?: unknown;
        learningRate?: unknown;
        reminderLeadDays?: unknown;
      };
      // Every shared setting moves INTO each team. A team's own backlogQuery
      // override (non-empty) wins over the project-level query; the project-level
      // reminder override becomes each team's override.
      const {
        teams,
        boardId,
        originalEffortField,
        currentEffortField,
        hoursPerDay,
        sprintLengthDays,
        datePolicy,
        nameTemplate,
        backlogQuery,
        learningRate,
        reminderLeadDays,
        ...rest
      } = config;
      const v3Teams = Array.isArray(teams) ? (teams as Record<string, unknown>[]) : [];
      return {
        ...doc,
        version: 4,
        config: {
          ...rest,
          version: 4,
          teams: v3Teams.map((team) => {
            const override = typeof team.backlogQuery === 'string' ? team.backlogQuery.trim() : '';
            return {
              ...team,
              boardId,
              originalEffortField,
              currentEffortField,
              hoursPerDay,
              sprintLengthDays,
              datePolicy,
              nameTemplate,
              backlogQuery: override !== '' ? team.backlogQuery : (backlogQuery ?? ''),
              learningRate,
              ...(reminderLeadDays === undefined ? {} : { reminderLeadDays }),
            };
          }),
        },
      };
    },
  },
];

/** Sprint data document (scpSprintDataJson) migrations. */
export const sprintDataMigrations: readonly Migration<Versioned>[] = [
  {
    fromVersion: 2,
    up: (doc) => {
      const sprints = (doc.sprints ?? {}) as Record<string, Versioned & Record<string, unknown>>;
      const migrated: Record<string, unknown> = {};
      for (const [sprintId, entry] of Object.entries(sprints)) {
        const {
          capacityRevision,
          capacity,
          focusFactor,
          focusFactorSource,
          focusFactorOverride,
          excludedFromCalibration,
          calibrationSkipReason,
          ...rest
        } = entry;
        migrated[sprintId] = {
          ...rest,
          teams: {
            [DEFAULT_TEAM_ID]: {
              capacityRevision,
              capacity,
              focusFactor,
              focusFactorSource,
              focusFactorOverride,
              excludedFromCalibration,
              calibrationSkipReason,
            },
          },
        };
      }
      return { ...doc, version: 3, sprints: migrated };
    },
  },
  {
    fromVersion: 3,
    up: (doc) => {
      // Re-key team-first: sprints[sprintId].teams[teamId] → teams[teamId].sprints
      // [sprintId], folding each entry's shared Sprint fields (sequence, name,
      // dates, audit stamps) into every team's copy. All teams shared one board in
      // v3, so the native Sprint ids remain valid for each team.
      const sprints = (doc.sprints ?? {}) as Record<string, Record<string, unknown>>;
      const byTeam: Record<string, { sprints: Record<string, unknown> }> = {};
      for (const [sprintId, entry] of Object.entries(sprints)) {
        const { teams, ...shared } = entry;
        for (const [teamId, teamEntry] of Object.entries(
          (teams ?? {}) as Record<string, Record<string, unknown>>,
        )) {
          byTeam[teamId] ??= { sprints: {} };
          byTeam[teamId].sprints[sprintId] = { ...shared, ...teamEntry };
        }
      }
      const { sprints: _sprints, ...docRest } = doc as Versioned & { sprints?: unknown };
      return { ...docRest, version: 4, teams: byTeam };
    },
  },
];
