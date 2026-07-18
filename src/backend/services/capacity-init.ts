/**
 * Seeds a fresh capacity document for a new Sprint from the current team config
 * (§7.3 / §9.2). Each enabled participant gets a row with available = default,
 * availableWasCustomized = false, confirmed = false, note = "".
 */
import { defaultCapacityForSprint } from '../../domain/index.js';
import type { CapacityDocument, CapacityRow, ProjectConfig } from '../../shared/types.js';
import type { YtUser } from '../repositories/youtrack-client.js';

export function seedCapacityDocument(
  config: ProjectConfig,
  users: readonly YtUser[],
  start: string,
  finish: string,
  now: number,
): CapacityDocument {
  const usersById = new Map(users.map((u) => [u.id, u]));
  const rows: Record<string, CapacityRow> = {};
  const defaultMinutes = defaultCapacityForSprint(start, finish, config.hoursPerDay);
  for (const participant of config.participants) {
    if (!participant.enabled) continue;
    const user = usersById.get(participant.userId);
    rows[participant.userId] = {
      userId: participant.userId,
      loginSnapshot: user?.login ?? participant.userId,
      displayNameSnapshot: user?.name ?? participant.userId,
      defaultMinutes,
      availableMinutes: defaultMinutes,
      availableWasCustomized: false,
      note: participant.note ?? '',
      updatedAt: now,
      updatedBy: participant.userId,
    };
  }
  return { version: 1, createdFromConfigVersion: config.version, rows };
}
