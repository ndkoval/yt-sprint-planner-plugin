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
 * v1 documents were keyed by REST database ids, which cannot be mapped to logins
 * offline, so v1 has no upgrade path: readers treat v1 documents as absent (the app
 * was pre-release). New schema versions add one sequential {@link Migration} each
 * (fromVersion N → N+1) and bump the CURRENT_* constant. Migrations must preserve
 * unknown fields and be idempotent.
 */
import { DEFAULT_TEAM_ID } from '../../shared/types.js';
import type { Migration, Versioned } from './migrations.js';

export const CURRENT_CAPACITY_VERSION = 2;
export const CURRENT_CONFIG_VERSION = 3;
export const CURRENT_SPRINT_DATA_VERSION = 3;

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
];
