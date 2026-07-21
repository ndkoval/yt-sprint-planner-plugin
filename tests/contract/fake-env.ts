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
  groups: string[];
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

  /** Build the {@link BackendUser} for a seeded login (unknown logins get an empty group set). */
  caller(login: string): BackendUser {
    const user = this.users.get(login);
    const groups = new Set(user?.groups ?? []);
    return {
      login,
      name: user?.name ?? login,
      isInGroup: (group: string) => groups.has(group),
    };
  }
}
