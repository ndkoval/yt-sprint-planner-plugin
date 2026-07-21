/**
 * The seam between the pure request handlers and YouTrack's in-process scripting API.
 * The real implementation (see {@link ./index.ts}) wraps
 * `@jetbrains/youtrack-scripting-api/entities`; contract tests supply a fake.
 */

/** The authenticated caller (from `ctx.currentUser` / `entities.User.current`). */
export interface BackendUser {
  login: string;
  name: string;
  isInGroup(groupName: string): boolean;
}

/** A resolved Project entity exposing only what the handlers need. */
export interface BackendProject {
  key: string;
  /** Login of the project leader, or null when unavailable. */
  leaderLogin: string | null;
  /** Read one `scp*` extension property (JSON string), or null when unset. */
  getProperty(name: string): string | null;
  /** Write one `scp*` extension property; null clears it. */
  setProperty(name: string, value: string | null): void;
}

export interface BackendEnv {
  /** Resolve a project by its key (shortName), or null when it does not exist. */
  findProjectByKey(key: string): BackendProject | null;
  /** Display name for a user login, or null when the user does not exist. */
  findUserNameByLogin(login: string): string | null;
  now(): number;
}
