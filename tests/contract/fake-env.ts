/**
 * In-memory {@link BackendEnv} for contract tests (§24). The handlers run for real
 * against this fake — only the YouTrack boundary (project entity + user directory) is
 * faked, and extension properties round-trip through a plain map so persistence is
 * observable. Native data (sprints, issues) is NOT modelled here: the backend never
 * touches it (that lives in the widget's REST client), so contract tests exercise the
 * app-state handlers in isolation.
 */
import type { BackendEnv, BackendProject, BackendUser } from '../../src/backend/env.js';

export interface FakeUser {
  login: string;
  name: string;
  /**
   * Whether this user holds YouTrack's `UPDATE_PROJECT` right — the app's entire
   * "manager" role (there is no app-specific permission scheme). A function grants
   * it per-project; a boolean grants it uniformly. Defaults to false.
   */
  canUpdateProject?: boolean | ((project: BackendProject) => boolean);
}

export class FakeProject implements BackendProject {
  readonly key: string;
  leaderLogin: string | null;
  readonly props = new Map<string, string>();

  constructor(key: string, leaderLogin: string | null) {
    this.key = key;
    this.leaderLogin = leaderLogin;
  }

  getProperty(name: string): string | null {
    const v = this.props.get(name);
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  setProperty(name: string, value: string | null): void {
    if (value === null) this.props.delete(name);
    else this.props.set(name, value);
  }
}

export class FakeEnv implements BackendEnv {
  private readonly projects = new Map<string, FakeProject>();
  private readonly users = new Map<string, FakeUser>();
  /** Per-user `scp*` extension properties (e.g. scpPrefsJson), keyed by login. */
  private readonly userPropsByLogin = new Map<string, Map<string, string>>();
  private clock: number;

  constructor(now = Date.UTC(2026, 0, 1)) {
    this.clock = now;
  }

  seedProject(key: string, leaderLogin: string | null): FakeProject {
    const project = new FakeProject(key, leaderLogin);
    this.projects.set(key, project);
    return project;
  }

  seedUser(user: FakeUser): this {
    this.users.set(user.login, user);
    return this;
  }

  setNow(ms: number): this {
    this.clock = ms;
    return this;
  }

  findProjectByKey(key: string): BackendProject | null {
    return this.projects.get(key) ?? null;
  }

  findUserNameByLogin(login: string): string | null {
    return this.users.get(login)?.name ?? null;
  }

  now(): number {
    return this.clock;
  }

  /** Read a stored USER extension property (test observability), or null when unset. */
  getUserProperty(login: string, name: string): string | null {
    return this.userPropsByLogin.get(login)?.get(name) ?? null;
  }

  /** Seed a USER extension property directly (models pre-existing/corrupt state). */
  setUserProperty(login: string, name: string, value: string | null): void {
    let props = this.userPropsByLogin.get(login);
    if (!props) {
      props = new Map<string, string>();
      this.userPropsByLogin.set(login, props);
    }
    if (value === null) props.delete(name);
    else props.set(name, value);
  }

  /** Build the {@link BackendUser} for a seeded login (unknown logins get no rights). */
  caller(login: string): BackendUser {
    const user = this.users.get(login);
    const grant = user?.canUpdateProject ?? false;
    return {
      login,
      name: user?.name ?? login,
      canUpdateProject: (project) => (typeof grant === 'function' ? grant(project) : grant),
      getProperty: (name) => {
        const v = this.getUserProperty(login, name);
        return typeof v === 'string' && v.length > 0 ? v : null;
      },
      setProperty: (name, value) => this.setUserProperty(login, name, value),
    };
  }
}
