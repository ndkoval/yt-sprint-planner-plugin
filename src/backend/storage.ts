/**
 * Loads and saves the app's project-scoped documents (Project extension properties
 * `scpConfigJson` and `scpSprintDataJson`), validating with the shared zod schemas.
 * Unreadable or older-versioned documents are treated as absent — v1 (REST-id keyed)
 * data has no offline upgrade path; see {@link ../domain/migrations/registry.ts}.
 */
import { configDocumentSchema, sprintDataDocumentSchema } from '../shared/schemas.js';
import type { ConfigDocument, SprintDataDocument } from '../shared/types.js';
import type { BackendProject } from './env.js';

export const CONFIG_PROP = 'scpConfigJson';
export const SPRINT_DATA_PROP = 'scpSprintDataJson';

function parseWith<T>(raw: string | null, parse: (v: unknown) => T): T | null {
  if (raw === null || raw.length === 0) return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadConfigDocument(project: BackendProject): ConfigDocument | null {
  return parseWith(project.getProperty(CONFIG_PROP), (v) => configDocumentSchema.parse(v));
}

export function saveConfigDocument(project: BackendProject, doc: ConfigDocument): void {
  project.setProperty(CONFIG_PROP, JSON.stringify(doc));
}

export function loadSprintData(project: BackendProject): SprintDataDocument {
  return (
    parseWith(project.getProperty(SPRINT_DATA_PROP), (v) => sprintDataDocumentSchema.parse(v)) ?? {
      version: 2,
      sprints: {},
    }
  );
}

export function saveSprintData(project: BackendProject, doc: SprintDataDocument): void {
  project.setProperty(SPRINT_DATA_PROP, JSON.stringify(doc));
}
