/**
 * Migration registries for each versioned document (§20.1). Every persisted JSON
 * document declares a `version`; when the app boots or reads a document, it runs the
 * matching registry up to the current version via {@link ./migrations.ts}.
 *
 * v1 is the first shipped schema, so every list is currently empty. New schema
 * versions add one sequential {@link Migration} each (fromVersion N → N+1) and bump
 * the CURRENT_* constant. Migrations must preserve unknown fields and be idempotent.
 */
import type { Migration, Versioned } from './migrations.js';

export const CURRENT_CAPACITY_VERSION = 1;
export const CURRENT_COMPLETION_VERSION = 1;
export const CURRENT_ISSUE_SNAPSHOT_VERSION = 1;
export const CURRENT_CONFIG_VERSION = 1;

/** Capacity document (scpCapacityJson) migrations. */
export const capacityMigrations: readonly Migration<Versioned>[] = [];

/** Completion calculation (scpCompletionCalculationJson) migrations. */
export const completionMigrations: readonly Migration<Versioned>[] = [];

/** Issue snapshot (scpMetricsSnapshotJson) migrations. */
export const issueSnapshotMigrations: readonly Migration<Versioned>[] = [];

/** Project config (scpConfigJson) migrations. */
export const configMigrations: readonly Migration<Versioned>[] = [];
