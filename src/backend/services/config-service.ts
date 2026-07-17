/**
 * Project configuration validation and persistence (§7). Validates the Board and
 * effort fields against live YouTrack state, and saves with optimistic concurrency
 * on the config revision (§17).
 */
import type { ProjectConfig } from '../../shared/types.js';
import { projectConfigSchema } from '../../shared/schemas.js';
import { AppError, configConflict } from '../errors.js';
import type { ConfigRepository } from '../repositories/config-repository.js';
import type { YouTrackClient } from '../repositories/youtrack-client.js';

export interface ValidationProblem {
  path: string;
  message: string;
}

export class ConfigService {
  constructor(
    private readonly client: YouTrackClient,
    private readonly repo: ConfigRepository,
    private readonly projectId: string,
  ) {}

  /**
   * Validate a config against live YouTrack state (§7.1/§7.2). Returns the list of
   * problems; an empty list means valid.
   */
  async validate(config: ProjectConfig): Promise<ValidationProblem[]> {
    const problems: ValidationProblem[] = [];

    // Schema-level validation first (bounds, shapes).
    const parsed = projectConfigSchema.safeParse(config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({ path: issue.path.join('.'), message: issue.message });
      }
      // If the shape is wrong, skip live checks — they'd be meaningless.
      return problems;
    }

    // Board must exist, be sprint-based, and include this project.
    const board = await this.client.getBoard(config.boardId);
    if (!board) {
      problems.push({ path: 'boardId', message: 'Board does not exist.' });
    } else {
      if (!board.usesSprints) {
        problems.push({ path: 'boardId', message: 'Board does not use Sprints.' });
      }
      if (!board.projectIds.includes(this.projectId)) {
        problems.push({ path: 'boardId', message: 'Project is not part of this Board.' });
      }
    }

    // Effort fields must exist, be attached, and be period-typed.
    const fields = await this.client.getProjectCustomFields(this.projectId);
    for (const [path, fieldName] of [
      ['originalEffortField', config.originalEffortField],
      ['currentEffortField', config.currentEffortField],
    ] as const) {
      const field = fields.find((f) => f.name === fieldName);
      if (!field) {
        problems.push({ path, message: `Field "${fieldName}" is not attached to the project.` });
      } else if (field.type !== 'period') {
        problems.push({ path, message: `Field "${fieldName}" is not a period field.` });
      }
    }

    return problems;
  }

  /** Save config with optimistic concurrency; bumps the revision. */
  async save(config: ProjectConfig, expectedRevision: number): Promise<{ revision: number }> {
    const current = await this.repo.load();
    if (current.revision !== expectedRevision) {
      throw configConflict();
    }
    const problems = await this.validate(config);
    if (problems.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Configuration is invalid.', { problems });
    }
    const newRevision = current.revision + 1;
    await this.repo.save(config, newRevision);
    return { revision: newRevision };
  }
}
