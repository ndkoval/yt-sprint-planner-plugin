/**
 * Absolute path helpers. The repo root is the parent of scripts/.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (…/scripts/lib -> …). */
export const REPO_ROOT = path.resolve(here, '..', '..');

export const DIST_DIR = path.join(REPO_ROOT, 'dist');
export const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts');
export const SRC_DIR = path.join(REPO_ROOT, 'src');
export const ZIP_PATH = path.join(DIST_DIR, 'sprint-capacity-planner.zip');

export function fromRoot(...segments) {
  return path.join(REPO_ROOT, ...segments);
}
