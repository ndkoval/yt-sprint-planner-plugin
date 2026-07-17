/**
 * Per-request context: resolves the calling principal (user + manager role) and
 * assembles the shared services. Manager role is determined by membership in the
 * configured Capacity Managers group (§7.7); it is always resolved server-side.
 */
import type { Principal } from '../domain/index.js';
import type { ConfigRepository } from './repositories/config-repository.js';
import type { YouTrackClient } from './repositories/youtrack-client.js';

/**
 * Resolve the calling principal. When no managers group is configured yet, no one is
 * a manager (settings must be seeded by an admin out-of-band or via first-run).
 */
export async function resolvePrincipal(
  client: YouTrackClient,
  configRepo: ConfigRepository,
): Promise<Principal> {
  const user = await client.getCurrentUser();
  const config = await configRepo.load();
  let isManager = false;
  if (config.managersGroup) {
    isManager = await client.isUserInGroup(user.id, config.managersGroup);
  }
  return { userId: user.id, isManager };
}
