/**
 * Typed client facade for the Sprint Capacity Planner widgets.
 *
 * Composition (see ../shared/api.ts):
 *  - Native YouTrack data → {@link NativeYouTrack} over `host.fetchYouTrack`
 *    (current user's session; YouTrack enforces real permissions).
 *  - App-owned state → the app backend over `host.fetchApp` (server-side authz).
 *  - Sprint metrics → computed live here with the shared domain math.
 *
 * The public method surface is what the components consume; keep it stable.
 */
import {
  bootstrapFocusFactor,
  computeMetrics,
  effectiveBacklogQuery,
  firstSprintDates,
  isCompletedSprint,
  isDuplicateName,
  nextFocusFactor,
  nextSprintDates,
  observedFocusFactor,
  rawCapacityMinutes,
  renderSprintName,
  resolveTeam,
  teamMemberLogins,
  utcMsToIso,
  type FocusFactorResult,
} from '../domain/index.js';
import type {
  ApiError,
  ApiErrorCode,
  BackendEnvelope,
  BoardSummary,
  ConfigResponse,
  CreateNextSprintRequest,
  IssueView,
  OverrideFocusFactorRequest,
  PatchCapacityRequest,
  PatchSprintDetailsRequest,
  PlanIssueRequest,
  ProjectFieldSummary,
  PutConfigRequest,
  SprintSummary,
  SprintView,
  UserPrefs,
  UserSummary,
} from '../shared/api.js';
import type { FocusFactorSource, ProjectConfig, SprintEntry } from '../shared/types.js';
import type { HostRequestInit, WidgetHost } from './host.js';
import { buildSprintView, toEffortIssue, toIssueView } from './sprint-view.js';
import { NativeYouTrack, type YtIssue, type YtSprint } from './youtrack-client.js';

export { buildSprintView } from './sprint-view.js';

/** HTTP-equivalent status by error code (for display/telemetry parity). */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_CONFIGURED: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CAPACITY_REVISION_CONFLICT: 409,
  CONFIG_REVISION_CONFLICT: 409,
  SPRINT_ALREADY_EXISTS: 409,
  INTERNAL_ERROR: 500,
};

/** Error thrown for any failed backend call, carrying the structured envelope. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly correlationId: string;
  readonly details: Record<string, unknown>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = STATUS_BY_CODE[error.code] ?? 500;
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.details = error.details;
  }

  /** True when the failure is an optimistic-concurrency conflict. */
  get isConflict(): boolean {
    return this.code === 'CAPACITY_REVISION_CONFLICT' || this.code === 'CONFIG_REVISION_CONFLICT';
  }
}

/** Typed client bound to a {@link WidgetHost}. */
export class ApiClient {
  private readonly yt: NativeYouTrack;
  private projectRef: { id: string; key: string } | null = null;
  private configCache: ProjectConfig | null = null;

  constructor(private readonly host: WidgetHost) {
    this.yt = new NativeYouTrack(host);
  }

  // --- Context ------------------------------------------------------------

  /** The current viewer's login, or null when the host cannot provide it. */
  async resolveUserId(): Promise<string | null> {
    return this.host.me.login.length > 0 ? this.host.me.login : null;
  }

  /** The current viewer (login + display name) as provided by the host. */
  get me(): { login: string; name: string } {
    return this.host.me;
  }

  /**
   * Resolve the project this widget is scoped to. In a project context YTApp.entity
   * is the project; in an issue context it is the issue carrying its project; a
   * dashboard falls back to an explicit ?projectId. The key (shortName) is what the
   * backend uses to resolve the Project entity.
   */
  private async project(): Promise<{ id: string; key: string }> {
    if (this.projectRef !== null) return this.projectRef;
    const entity = this.host.entity;
    const fromProject = entity?.project;
    const id =
      (typeof fromProject?.id === 'string' && fromProject.id.length > 0 ? fromProject.id : null) ??
      (typeof entity?.id === 'string' && entity.id.length > 0 ? entity.id : null) ??
      new URLSearchParams(window.location.search).get('projectId');
    if (id === null || id.length === 0) {
      throw new Error('Unable to resolve the current project from the YouTrack host.');
    }
    const key =
      (typeof fromProject?.shortName === 'string' && fromProject.shortName.length > 0
        ? fromProject.shortName
        : null) ??
      (typeof entity?.shortName === 'string' && entity.shortName.length > 0
        ? entity.shortName
        : null) ??
      (await this.yt.getProject(id)).key;
    this.projectRef = { id, key };
    return this.projectRef;
  }

  /** The current project's key (shortName) — e.g. for project-scoped search defaults. */
  async projectKey(): Promise<string> {
    return (await this.project()).key;
  }

  /**
   * Whether the HOST provides a project context (project/issue placements do; the
   * main-menu and bare dashboard placements don't — those show a project picker
   * and bind late via {@link useProject}).
   */
  hostHasProjectContext(): boolean {
    const entity = this.host.entity;
    return Boolean(
      (typeof entity?.project?.id === 'string' && entity.project.id.length > 0) ||
        (typeof entity?.id === 'string' && entity.id.length > 0) ||
        new URLSearchParams(window.location.search).get('projectId'),
    );
  }

  /** True once a project is resolvable (host context or a picked project). */
  hasProjectContext(): boolean {
    return this.projectRef !== null || this.hostHasProjectContext();
  }

  /** Bind the client to a picked project (main-menu placement). */
  useProject(project: { id: string; key: string }): void {
    this.projectRef = { id: project.id, key: project.key };
    this.configCache = null;
  }

  /** Projects visible to the current user, for the project picker. */
  async listProjects(): Promise<Array<{ id: string; key: string; name: string }>> {
    return this.yt.listProjects();
  }

  /** Call the YouTrack REST API directly (in the current user's context). */
  fetchYouTrack(path: string, init?: HostRequestInit): Promise<unknown> {
    return this.host.fetchYouTrack(path, init);
  }

  enterModalMode(): Promise<void> {
    return this.host.enterModalMode();
  }

  exitModalMode(): Promise<void> {
    return this.host.exitModalMode();
  }

  // --- Backend transport ----------------------------------------------------

  private async app<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const { key } = await this.project();
    return this.appRaw(method, path, { project: key }, body);
  }

  /** Backend call WITHOUT a project scope (per-user endpoints like prefs). */
  private async appGlobal<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return this.appRaw(method, path, {}, body);
  }

  private async appRaw<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const raw = (await this.host.fetchApp(`backend/${path}`, {
      method,
      query,
      ...(body !== undefined ? { body } : {}),
    })) as BackendEnvelope<T> | null;
    if (raw && typeof raw === 'object' && 'ok' in raw) {
      if (raw.ok) return raw.data;
      throw new ApiClientError(raw.error);
    }
    throw new ApiClientError({
      code: 'INTERNAL_ERROR',
      message: 'The app backend returned an unexpected response.',
      details: {},
      correlationId: '',
    });
  }

  // --- Per-user preferences ---------------------------------------------------

  /** The caller's app preferences (e.g. the last-picked project); {} on any failure. */
  async getPrefs(): Promise<UserPrefs> {
    return this.appGlobal<UserPrefs>('GET', 'prefs').catch(() => ({}));
  }

  /** Persist the last-picked project (null clears it). Best-effort. */
  async saveLastProject(lastProjectKey: string | null): Promise<void> {
    await this.appGlobal('POST', 'prefs', { lastProjectKey }).catch(() => {});
  }

  private async requireConfig(): Promise<ProjectConfig> {
    if (this.configCache !== null) return this.configCache;
    const response = await this.getConfig();
    if (!response.config) {
      throw new ApiClientError({
        code: 'NOT_CONFIGURED',
        message: 'Board is not configured.',
        details: {},
        correlationId: '',
      });
    }
    return response.config;
  }

  // --- Configuration -------------------------------------------------------

  async getConfig(): Promise<ConfigResponse> {
    const response = await this.app<ConfigResponse>('GET', 'config');
    this.configCache = response.config;
    return response;
  }

  async putConfig(body: PutConfigRequest): Promise<ConfigResponse> {
    const response = await this.app<ConfigResponse>('POST', 'config', body);
    this.configCache = response.config;
    return response;
  }

  /**
   * Boards available to THIS project (other projects' boards would silently break
   * sprint reads, so they are filtered out here). `usesSprints` lets the settings
   * form flag boards with sprints disabled.
   */
  async getBoards(): Promise<BoardSummary[]> {
    const { id } = await this.project();
    const boards = await this.yt.listBoards();
    return boards
      .filter((b) => b.projectIds.includes(id))
      .map((b) => ({ id: b.id, name: b.name, usesSprints: b.usesSprints }));
  }

  /** Search users for the participant / assignee pickers. */
  async searchUsers(query: string): Promise<UserSummary[]> {
    return this.yt.searchUsers(query);
  }

  /** Project custom fields for the effort-field pickers. */
  async getProjectFields(): Promise<ProjectFieldSummary[]> {
    const { id } = await this.project();
    return this.yt.getProjectCustomFields(id);
  }

  // --- Sprints -------------------------------------------------------------

  private sprintEntries(): Promise<Record<string, SprintEntry>> {
    return this.app<{ sprints: Record<string, SprintEntry> }>('GET', 'sprint-data').then(
      (d) => d.sprints,
    );
  }

  async listSprints(): Promise<SprintSummary[]> {
    const config = await this.requireConfig();
    const [sprints, entries] = await Promise.all([
      this.yt.listSprints(config.boardId),
      this.sprintEntries(),
    ]);
    const summaries: SprintSummary[] = sprints.map((s) => ({
      id: s.id,
      name: s.name,
      start: s.start ?? '',
      finish: s.finish ?? '',
      archived: s.archived,
      managed: s.id in entries,
      sequence: entries[s.id]?.sequence ?? 0,
      unresolvedIssueCount: 0,
    }));
    // The carry-over preview needs the unresolved count of the LATEST managed Sprint.
    const latest = summaries
      .filter((s) => s.managed)
      .reduce<SprintSummary | null>((a, s) => (a === null || s.sequence > a.sequence ? s : a), null);
    if (latest) {
      const issues = await this.yt.getSprintIssues(
        config.boardId,
        latest.id,
        config.originalEffortField,
        config.currentEffortField,
      );
      latest.unresolvedIssueCount = issues.filter((i) => !i.resolved).length;
    }
    return summaries;
  }

  async getSprint(sprintId: string): Promise<SprintView> {
    const config = await this.requireConfig();
    const [native, entries] = await Promise.all([
      this.yt.getSprint(config.boardId, sprintId),
      this.sprintEntries(),
    ]);
    if (!native) {
      throw new ApiClientError({
        code: 'NOT_FOUND',
        message: `Sprint ${sprintId} was not found.`,
        details: {},
        correlationId: '',
      });
    }
    const issues =
      native.start !== null && native.finish !== null
        ? await this.yt.getSprintIssues(
            config.boardId,
            sprintId,
            config.originalEffortField,
            config.currentEffortField,
          )
        : [];
    return buildSprintView(native, entries[sprintId] ?? null, config.teams, issues, Date.now());
  }

  /** The Sprint's issues (with assignee + effort) for the planning board. */
  async listSprintIssues(sprintId: string): Promise<IssueView[]> {
    const config = await this.requireConfig();
    const issues = await this.yt.getSprintIssues(
      config.boardId,
      sprintId,
      config.originalEffortField,
      config.currentEffortField,
    );
    return issues.map(toIssueView);
  }

  /**
   * The backlog pool for one team (its override query, else the project query),
   * minus issues already in the Sprint. `teamId` omitted = single-team project.
   */
  async listBacklog(sprintId: string, teamId?: string): Promise<IssueView[]> {
    const config = await this.requireConfig();
    const team = resolveTeam(config, teamId);
    const query = team ? effectiveBacklogQuery(config, team) : (config.backlogQuery ?? '').trim();
    if (query.length === 0) return [];
    const [candidates, sprintIssues] = await Promise.all([
      this.yt.searchIssues(query, config.originalEffortField, config.currentEffortField),
      this.yt.getSprintIssues(
        config.boardId,
        sprintId,
        config.originalEffortField,
        config.currentEffortField,
      ),
    ]);
    const inSprint = new Set(sprintIssues.map((i) => i.id));
    return candidates.filter((i) => !inSprint.has(i.id) && !i.resolved).map(toIssueView);
  }

  /**
   * Plan an issue (a board drag): pull it into/out of the Sprint and set its assignee
   * in one action. Runs as the current user, so YouTrack enforces the caller's board
   * and issue permissions. Returns the refreshed SprintView.
   */
  async planIssue(sprintId: string, issueId: string, body: PlanIssueRequest): Promise<SprintView> {
    const config = await this.requireConfig();
    const current = await this.yt.getSprintIssues(
      config.boardId,
      sprintId,
      config.originalEffortField,
      config.currentEffortField,
    );
    const alreadyInSprint = current.some((i) => i.id === issueId);
    if (body.inSprint) {
      if (!alreadyInSprint) await this.yt.addIssueToSprint(config.boardId, sprintId, issueId);
      await this.yt.setIssueAssignee(issueId, body.assigneeId);
    } else if (alreadyInSprint) {
      await this.yt.removeIssueFromSprint(config.boardId, sprintId, issueId);
    }
    return this.getSprint(sprintId);
  }

  /**
   * One-click "Create next Sprint": compute dates/sequence/name from the managed
   * history, create the native Sprint (current user's own board permission), register
   * the app state (sequence + seeded capacity), optionally carry unresolved issues over.
   */
  async createNextSprint(request: CreateNextSprintRequest): Promise<SprintView> {
    const config = await this.requireConfig();
    const [sprints, entries] = await Promise.all([
      this.yt.listSprints(config.boardId),
      this.sprintEntries(),
    ]);
    const managed = sprints.filter((s) => s.id in entries);
    const previous = managed.reduce<YtSprint | null>(
      (a, s) => (a === null || entries[s.id]!.sequence > entries[a.id]!.sequence ? s : a),
      null,
    );

    const dates = previous?.finish
      ? nextSprintDates(previous.finish, config.sprintLengthDays)
      : firstSprintDates(utcMsToIso(Date.now()), config.sprintLengthDays);
    const sequences = Object.values(entries).map((e) => e.sequence);
    const sequence = sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
    const name = renderSprintName(config.nameTemplate, {
      year: Number(dates.start.slice(0, 4)),
      sequence,
      startDate: dates.start,
      finishDate: dates.finish,
    });

    // Duplicate checks — resume if an identical Sprint already exists.
    const duplicate = managed.find((s) => s.start === dates.start && s.finish === dates.finish);
    if (duplicate) return this.getSprint(duplicate.id);
    if (isDuplicateName(name, sprints.map((s) => s.name))) {
      throw new ApiClientError({
        code: 'SPRINT_ALREADY_EXISTS',
        message: `A Sprint named "${name}" already exists.`,
        details: { name },
        correlationId: '',
      });
    }

    const factors = await this.computeNextTeamFocusFactors(config, managed, entries);
    const created = await this.yt.createSprint({
      boardId: config.boardId,
      name,
      goal: request.goal ?? '',
      start: dates.start,
      finish: dates.finish,
    });
    const teamSeeds: Record<string, { focusFactor: number; focusFactorSource: FocusFactorSource }> =
      {};
    for (const [teamId, factor] of Object.entries(factors)) {
      teamSeeds[teamId] = { focusFactor: factor.value, focusFactorSource: factor.source };
    }
    await this.app('POST', 'sprint-register', {
      sprint: { id: created.id, name: created.name, start: dates.start, finish: dates.finish },
      teams: teamSeeds,
    });
    if (request.moveUnresolvedIssues && previous) {
      await this.yt.moveUnresolvedIssues(config.boardId, previous.id, created.id);
    }
    return this.getSprint(created.id);
  }

  /**
   * Calibrate the next Sprint's Focus Factor PER TEAM, each from that team's latest
   * completed, eligible managed Sprint (live figures — computed from current issues,
   * filtered to the team's members). Teams calibrate independently: one team's
   * over/under-delivery never moves another team's factor.
   */
  private async computeNextTeamFocusFactors(
    config: ProjectConfig,
    managed: readonly YtSprint[],
    entries: Record<string, SprintEntry>,
  ): Promise<Record<string, FocusFactorResult>> {
    const now = Date.now();
    const completed = managed.filter((s) => s.finish !== null && isCompletedSprint(s.finish, now));
    const issuesBySprint = new Map<string, readonly YtIssue[]>();
    const sprintIssues = async (sprintId: string): Promise<readonly YtIssue[]> => {
      const cached = issuesBySprint.get(sprintId);
      if (cached) return cached;
      const issues = await this.yt.getSprintIssues(
        config.boardId,
        sprintId,
        config.originalEffortField,
        config.currentEffortField,
      );
      issuesBySprint.set(sprintId, issues);
      return issues;
    };

    const factors: Record<string, FocusFactorResult> = {};
    for (const team of config.teams) {
      const eligible = completed
        .filter((s) => entries[s.id]!.teams[team.id] !== undefined)
        .filter((s) => !entries[s.id]!.teams[team.id]!.excludedFromCalibration)
        .filter((s) => rawCapacityMinutes(entries[s.id]!.teams[team.id]!.capacity) > 0);
      if (eligible.length === 0) {
        factors[team.id] = bootstrapFocusFactor();
        continue;
      }
      const source = eligible.reduce((latest, s) =>
        (s.finish ?? '') > (latest.finish ?? '') ? s : latest,
      );
      const teamEntry = entries[source.id]!.teams[team.id]!;
      const logins = teamMemberLogins(team);
      const issues = await sprintIssues(source.id);
      const teamIssues = issues
        .map(toEffortIssue)
        .filter((i) => i.assigneeId !== null && i.assigneeId !== undefined && logins.has(i.assigneeId));
      const metrics = computeMetrics(
        teamEntry.capacity,
        teamIssues,
        source.start!,
        source.finish!,
        teamEntry.focusFactor,
      );
      const observed = observedFocusFactor(
        metrics.completedOriginalEffortMinutes,
        metrics.rawCapacityMinutes,
      );
      // Carry forward when nothing could be observed (no team effort or no capacity).
      const carryForward = metrics.originalEffortMinutes === 0 || observed === null;
      factors[team.id] = nextFocusFactor(
        { previousFactor: teamEntry.focusFactor, observed, carryForward },
        { learningRate: config.learningRate },
      );
    }
    return factors;
  }

  /** Edit native Sprint details, then resync the app snapshot (defaults recompute). */
  async patchSprintDetails(sprintId: string, patch: PatchSprintDetailsRequest): Promise<SprintView> {
    const config = await this.requireConfig();
    const current = await this.yt.getSprint(config.boardId, sprintId);
    if (!current) {
      throw new ApiClientError({
        code: 'NOT_FOUND',
        message: `Sprint ${sprintId} was not found.`,
        details: {},
        correlationId: '',
      });
    }
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new ApiClientError({
        code: 'VALIDATION_FAILED',
        message: 'Sprint name is required.',
        details: {},
        correlationId: '',
      });
    }
    const start = patch.start ?? current.start;
    const finish = patch.finish ?? current.finish;
    if (start && finish && finish <= start) {
      throw new ApiClientError({
        code: 'VALIDATION_FAILED',
        message: 'Finish must be after start.',
        details: {},
        correlationId: '',
      });
    }
    const updated = await this.yt.updateSprint(config.boardId, sprintId, patch);
    if (updated.start !== null && updated.finish !== null) {
      await this.app('POST', 'sprint-register', {
        sprint: { id: sprintId, name: updated.name, start: updated.start, finish: updated.finish },
      });
    }
    return this.getSprint(sprintId);
  }

  // --- Capacity (team-scoped) ------------------------------------------------

  /**
   * Write one capacity row, then VERIFY the change is really persisted and re-apply
   * if not. The platform stores all sprint state in one extension property with
   * last-write-wins semantics (verified on 2025.3): two simultaneous writes to
   * DIFFERENT teams pass their per-team revision checks yet one whole-document write
   * can clobber the other. Same-team races still surface as revision conflicts
   * (thrown to the caller — the ConflictBanner flow); this loop only heals the silent
   * cross-team case by re-applying the delta on top of the fresh document.
   */
  private async writeCapacityVerified(
    sprintId: string,
    teamId: string,
    target: 'me' | { userId: string },
    body: PatchCapacityRequest,
  ): Promise<SprintView> {
    const login = target === 'me' ? this.host.me.login : target.userId;
    let expectedRevision = body.expectedRevision;
    let view: SprintView;
    for (let attempt = 0; ; attempt += 1) {
      await this.app('POST', 'capacity', { sprintId, teamId, target, ...body, expectedRevision });
      view = await this.getSprint(sprintId);
      const row = view.teams.find((t) => t.teamId === teamId)?.capacity.rows[login];
      const applied =
        row !== undefined &&
        (body.availableMinutes === undefined || row.availableMinutes === body.availableMinutes) &&
        (body.note === undefined || row.note === body.note);
      if (applied || attempt >= 2) return view;
      const teamView = view.teams.find((t) => t.teamId === teamId);
      expectedRevision = teamView?.capacityRevision ?? expectedRevision;
    }
  }

  async patchMyCapacity(
    sprintId: string,
    teamId: string,
    body: PatchCapacityRequest,
  ): Promise<SprintView> {
    return this.writeCapacityVerified(sprintId, teamId, 'me', body);
  }

  async patchUserCapacity(
    sprintId: string,
    teamId: string,
    userId: string,
    body: PatchCapacityRequest,
  ): Promise<SprintView> {
    return this.writeCapacityVerified(sprintId, teamId, { userId }, body);
  }

  async resetUserCapacity(
    sprintId: string,
    teamId: string,
    userId: string,
    expectedRevision: number,
  ): Promise<SprintView> {
    await this.app('POST', 'capacity-reset', { sprintId, teamId, userId, expectedRevision });
    return this.getSprint(sprintId);
  }

  // --- Focus factor / calibration (team-scoped) ------------------------------

  async overrideFocusFactor(
    sprintId: string,
    teamId: string,
    body: Omit<OverrideFocusFactorRequest, 'sprintId' | 'teamId'>,
  ): Promise<SprintView> {
    // Verified write — see writeCapacityVerified for the cross-team race rationale.
    let view: SprintView;
    for (let attempt = 0; ; attempt += 1) {
      await this.app('POST', 'focus-factor', { sprintId, teamId, ...body });
      view = await this.getSprint(sprintId);
      const team = view.teams.find((t) => t.teamId === teamId);
      if ((team !== undefined && team.focusFactor === body.newValue) || attempt >= 2) return view;
    }
  }

  async excludeFromCalibration(
    sprintId: string,
    teamId: string,
    body: { reason: string },
  ): Promise<SprintView> {
    await this.app('POST', 'calibration', { sprintId, teamId, excluded: true, reason: body.reason });
    return this.getSprint(sprintId);
  }

  async includeInCalibration(sprintId: string, teamId: string): Promise<SprintView> {
    await this.app('POST', 'calibration', { sprintId, teamId, excluded: false });
    return this.getSprint(sprintId);
  }
}
