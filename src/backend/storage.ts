/**
 * Loads and saves the app's project-scoped documents (Project extension properties
 * `scpConfigJson` and `scpSprintDataJson`), validating with the shared zod schemas.
 *
 * Older-versioned documents are migrated ON READ through the registered chains
 * (v2 → v3 wraps the flat single-team data into a default team) and persisted on the
 * next write — there is no write-on-read. Unreadable documents (malformed JSON,
 * failed validation, or v1 — REST-id keyed data with no offline upgrade path) are
 * treated as absent; see {@link ../domain/migrations/registry.ts}.
 */
import {
  CURRENT_CONFIG_VERSION,
  CURRENT_SPRINT_DATA_VERSION,
  configMigrations,
  sprintDataMigrations,
} from '../domain/migrations/registry.js';
import { migrate, type Migration, type Versioned } from '../domain/migrations/migrations.js';
import { configDocumentSchema, sprintDataDocumentSchema } from '../shared/schemas.js';
import type { ConfigDocument, SprintDataDocument } from '../shared/types.js';
import type { BackendProject } from './env.js';

export const CONFIG_PROP = 'scpConfigJson';
export const SPRINT_DATA_PROP = 'scpSprintDataJson';

/**
 * Bring a raw parsed document up to `targetVersion`, then strict-validate it.
 * Returns null when the value is not a versioned object, the chain cannot reach the
 * target (e.g. v1), or the migrated result fails validation.
 */
function normalize<T>(
  value: unknown,
  targetVersion: number,
  migrations: readonly Migration<Versioned>[],
  parse: (v: unknown) => T,
): T | null {
  if (value === null || typeof value !== 'object') return null;
  const version = (value as { version?: unknown }).version;
  if (typeof version !== 'number' || version > targetVersion) return null;
  try {
    const current =
      version === targetVersion ? value : migrate(value as Versioned, targetVersion, migrations);
    return parse(current);
  } catch {
    return null;
  }
}

/** Migrate + validate an untrusted config document value (also used by import). */
export function normalizeConfigDocument(value: unknown): ConfigDocument | null {
  return normalize(value, CURRENT_CONFIG_VERSION, configMigrations, (v) =>
    configDocumentSchema.parse(v),
  );
}

/** Migrate + validate an untrusted sprint-data document value (also used by import). */
export function normalizeSprintData(value: unknown): SprintDataDocument | null {
  return normalize(value, CURRENT_SPRINT_DATA_VERSION, sprintDataMigrations, (v) =>
    sprintDataDocumentSchema.parse(v),
  );
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadConfigDocument(project: BackendProject): ConfigDocument | null {
  return normalizeConfigDocument(parseJson(project.getProperty(CONFIG_PROP)));
}

export function saveConfigDocument(project: BackendProject, doc: ConfigDocument): void {
  project.setProperty(CONFIG_PROP, JSON.stringify(doc));
}

export function loadSprintData(project: BackendProject): SprintDataDocument {
  return (
    normalizeSprintData(parseJson(project.getProperty(SPRINT_DATA_PROP))) ?? {
      version: 3,
      sprints: {},
    }
  );
}

export function saveSprintData(project: BackendProject, doc: SprintDataDocument): void {
  project.setProperty(SPRINT_DATA_PROP, JSON.stringify(doc));
}
