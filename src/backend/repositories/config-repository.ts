/**
 * Reads/writes the per-project configuration stored in the Project extension
 * properties (scpConfigJson, scpConfigRevision, scpCapacityManagers).
 */
import type { ProjectConfig } from '../../shared/types.js';
import { projectConfigSchema } from '../../shared/schemas.js';
import type { YouTrackClient } from './youtrack-client.js';

export interface ConfigRecord {
  configured: boolean;
  revision: number;
  config: ProjectConfig | null;
  /** Name of the YouTrack group whose members are Capacity Managers. */
  managersGroup: string | null;
}

export class ConfigRepository {
  constructor(
    private readonly client: YouTrackClient,
    private readonly projectId: string,
  ) {}

  async load(): Promise<ConfigRecord> {
    const raw = await this.client.getExtensionProperties('Project', this.projectId, [
      'scpConfigJson',
      'scpConfigRevision',
      'scpCapacityManagers',
    ]);
    const json = raw.scpConfigJson;
    let config: ProjectConfig | null = null;
    if (typeof json === 'string' && json.length > 0) {
      try {
        config = projectConfigSchema.parse(JSON.parse(json));
      } catch {
        config = null;
      }
    }
    return {
      configured: config !== null,
      revision: typeof raw.scpConfigRevision === 'number' ? raw.scpConfigRevision : 0,
      config,
      managersGroup:
        typeof raw.scpCapacityManagers === 'string' && raw.scpCapacityManagers.length > 0
          ? raw.scpCapacityManagers
          : null,
    };
  }

  /** Persist config, bumping the revision. Caller has already validated concurrency. */
  async save(config: ProjectConfig, newRevision: number): Promise<void> {
    await this.client.setExtensionProperties('Project', this.projectId, {
      scpConfigJson: JSON.stringify(config),
      scpConfigRevision: newRevision,
    });
  }

  async saveManagersGroup(group: string): Promise<void> {
    await this.client.setExtensionProperty(
      'Project',
      this.projectId,
      'scpCapacityManagers',
      group,
    );
  }
}
