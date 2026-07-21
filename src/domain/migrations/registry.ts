/**
 * Migration registries for each versioned document (§20.1). Every persisted JSON
 * document declares a `version`; when the app reads a document, it runs the matching
 * registry up to the current version via {@link ./migrations.ts}.
 *
 * v2 is the first schema of the project-scoped storage model (login-keyed capacity
 * rows, config + per-Sprint state in project extension properties). v1 documents were
 * keyed by REST database ids, which cannot be mapped to logins offline, so v1 has no
 * upgrade path: readers treat v1 documents as absent (the app was pre-release). New
 * schema versions add one sequential {@link Migration} each (fromVersion N → N+1) and
 * bump the CURRENT_* constant. Migrations must preserve unknown fields and be
 * idempotent.
 */
import type { Migration, Versioned } from './migrations.js';

export const CURRENT_CAPACITY_VERSION = 2;
export const CURRENT_CONFIG_VERSION = 2;
export const CURRENT_SPRINT_DATA_VERSION = 2;

/** Capacity document migrations. */
export const capacityMigrations: readonly Migration<Versioned>[] = [];

/** Project config (scpConfigJson) migrations. */
export const configMigrations: readonly Migration<Versioned>[] = [];

/** Sprint data document (scpSprintDataJson) migrations. */
export const sprintDataMigrations: readonly Migration<Versioned>[] = [];
