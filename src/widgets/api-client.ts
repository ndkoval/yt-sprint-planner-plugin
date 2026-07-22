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
import type { Team, TeamSprint } from '../shared/types.js';
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
import type { ProjectConfig } from '../shared/types.js';
import type { HostRequestInit, WidgetHost } from './host.js';
import { buildSprintView, toEffortIssue, toIssueView } from './sprint-view.js';
import { NativeYouTrack, type YtSprint } from './youtrack-client.js';

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

  private async app<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraQuery?: Record<string, string>,
  ): Promise<T> {
    const { key } = await this.project();
    return this.appRaw(method, path, { project: key, ...(extraQuery ?? {}) }, body);
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

  /** Persist the last-picked team of a project (null forgets it). Best-effort. */
  async saveLastTeam(projectKey: string, teamId: string | null): Promise<void> {
    await this.appGlobal('POST', 'prefs', { lastTeam: { projectKey, teamId } }).catch(() => {});
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

  // --- Sprints (team-scoped: each team plans on its OWN board) ---------------

  /** Resolve the targeted team (explicit id, or the config's only team). */
  private async requireTeam(teamId?: string): Promise<Team> {
    const config = await this.requireConfig();
    const team = resolveTeam(config, teamId);
    if (team) return team;
    throw new ApiClientError({
      code: 'VALIDATION_FAILED',
      message:
        teamId === undefined
          ? 'This project has several teams — specify which team the request targets.'
          : `Unknown team "${teamId}".`,
      details: { teamId: teamId ?? null },
      correlationId: '',
    });
  }

  private sprintEntries(teamId: string): Promise<Record<string, TeamSprint>> {
    return this.app<{ sprints: Record<string, TeamSprint> }>('GET', 'sprint-data', undefined, {
      team: teamId,
    }).then((d) => d.sprints);
  }

  async listSprints(teamId?: string): Promise<SprintSummary[]> {
    const team = await this.requireTeam(teamId);
    const [sprints, entries] = await Promise.all([
      this.yt.listSprints(team.boardId),
      this.sprintEntries(team.id),
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
    // The carry-over preview needs the unresolved count of the team's LATEST
    // managed Sprint.
    const latest = summaries
      .filter((s) => s.managed)
      .reduce<SprintSummary | null>((a, s) => (a === null || s.sequence > a.sequence ? s : a), null);
    if (latest) {
      const issues = await this.yt.getSprintIssues(
        team.boardId,
        latest.id,
        team.originalEffortField,
        team.currentEffortField,
      );
      latest.unresolvedIssueCount = issues.filter((i) => !i.resolved).length;
    }
    return summaries;
  }

  async getSprint(sprintId: string, teamId?: string): Promise<SprintView> {
    const team = await this.requireTeam(teamId);
    const [native, entries] = await Promise.all([
      this.yt.getSprint(team.boardId, sprintId),
      this.sprintEntries(team.id),
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
            team.boardId,
            sprintId,
            team.originalEffortField,
            team.currentEffortField,
          )
        : [];
    return buildSprintView(native, entries[sprintId] ?? null, team, issues, Date.now());
  }

  /** The Sprint's issues (with assignee + effort) for the planning board. */
  async listSprintIssues(sprintId: string, teamId?: string): Promise<IssueView[]> {
    const team = await this.requireTeam(teamId);
    const issues = await this.yt.getSprintIssues(
      team.boardId,
      sprintId,
      team.originalEffortField,
      team.currentEffortField,
    );
    return issues.map(toIssueView);
  }

  /**
   * The team's backlog pool (its own query — empty hides the lane), minus issues
   * already in the Sprint.
   */
  async listBacklog(sprintId: string, teamId?: string): Promise<IssueView[]> {
    const team = await this.requireTeam(teamId);
    const query = effectiveBacklogQuery(team);
    if (query.length === 0) return [];
    const [candidates, sprintIssues] = await Promise.all([
      this.yt.searchIssues(query, team.originalEffortField, team.currentEffortField),
      this.yt.getSprintIssues(
        team.boardId,
        sprintId,
        team.originalEffortField,
        team.currentEffortField,
      ),
    ]);
    const inSprint = new Set(sprintIssues.map((i) => i.id));
    return candidates.filter((i) => !inSprint.has(i.id) && !i.resolved).map(toIssueView);
  }

  /**
   * Plan an issue (a board drag): pull it into/out of the team's Sprint and set its
   * assignee in one action. Runs as the current user, so YouTrack enforces the
   * caller's board and issue permissions. Returns the refreshed SprintView.
   */
  async planIssue(
    sprintId: string,
    issueId: string,
    body: PlanIssueRequest,
    teamId?: string,
  ): Promise<SprintView> {
    const team = await this.requireTeam(teamId);
    const current = await this.yt.getSprintIssues(
      team.boardId,
      sprintId,
      team.originalEffortField,
      team.currentEffortField,
    );
    const alreadyInSprint = current.some((i) => i.id === issueId);
    if (body.inSprint) {
      if (!alreadyInSprint) await this.yt.addIssueToSprint(team.boardId, sprintId, issueId);
      await this.yt.setIssueAssignee(issueId, body.assigneeId);
    } else if (alreadyInSprint) {
      await this.yt.removeIssueFromSprint(team.boardId, sprintId, issueId);
    }
    return this.getSprint(sprintId, team.id);
  }

  /**
   * One-click "Create next Sprint" for the TEAM: compute dates/sequence/name from
   * the team's managed history, create the native Sprint on the team's board
   * (current user's own board permission), register the team's app state (sequence +
   * seeded capacity), optionally carry unresolved issues over.
   */
  async createNextSprint(request: CreateNextSprintRequest, teamId?: string): Promise<SprintView> {
    const team = await this.requireTeam(teamId);
    const [sprints, entries] = await Promise.all([
      this.yt.listSprints(team.boardId),
      this.sprintEntries(team.id),
    ]);
    const managed = sprints.filter((s) => s.id in entries);
    const previous = managed.reduce<YtSprint | null>(
      (a, s) => (a === null || entries[s.id]!.sequence > entries[a.id]!.sequence ? s : a),
      null,
    );

    const dates = previous?.finish
      ? nextSprintDates(previous.finish, team.sprintLengthDays)
      : firstSprintDates(utcMsToIso(Date.now()), team.sprintLengthDays);
    const sequences = Object.values(entries).map((e) => e.sequence);
    const sequence = sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
    const name = renderSprintName(team.nameTemplate, {
      year: Number(dates.start.slice(0, 4)),
      sequence,
      startDate: dates.start,
      finishDate: dates.finish,
    });

    // Duplicate checks — resume if an identical Sprint already exists.
    const duplicate = managed.find((s) => s.start === dates.start && s.finish === dates.finish);
    if (duplicate) return this.getSprint(duplicate.id, team.id);
    if (isDuplicateName(name, sprints.map((s) => s.name))) {
      throw new ApiClientError({
        code: 'SPRINT_ALREADY_EXISTS',
        message: `A Sprint named "${name}" already exists.`,
        details: { name },
        correlationId: '',
      });
    }

    const factor = await this.computeNextFocusFactor(team, managed, entries);
    const created = await this.yt.createSprint({
      boardId: team.boardId,
      name,
      goal: request.goal ?? '',
      start: dates.start,
      finish: dates.finish,
    });
    await this.app('POST', 'sprint-register', {
      teamId: team.id,
      sprint: { id: created.id, name: created.name, start: dates.start, finish: dates.finish },
      seed: { focusFactor: factor.value, focusFactorSource: factor.source },
    });
    if (request.moveUnresolvedIssues && previous) {
      await this.yt.moveUnresolvedIssues(team.boardId, previous.id, created.id);
    }
    return this.getSprint(created.id, team.id);
  }

  /**
   * Calibrate the team's next Focus Factor from its latest completed, eligible
   * managed Sprint (live figures — computed from current issues, filtered to the
   * team's members). Teams calibrate independently with their OWN learning rate:
   * one team's over/under-delivery never moves another team's factor.
   */
  private async computeNextFocusFactor(
    team: Team,
    managed: readonly YtSprint[],
    entries: Record<string, TeamSprint>,
  ): Promise<FocusFactorResult> {
    const now = Date.now();
    const eligible = managed
      .filter((s) => s.finish !== null && isCompletedSprint(s.finish, now))
      .filter((s) => !entries[s.id]!.excludedFromCalibration)
      .filter((s) => rawCapacityMinutes(entries[s.id]!.capacity) > 0);
    if (eligible.length === 0) return bootstrapFocusFactor();

    const source = eligible.reduce((latest, s) =>
      (s.finish ?? '') > (latest.finish ?? '') ? s : latest,
    );
    const entry = entries[source.id]!;
    const logins = teamMemberLogins(team);
    const issues = await this.yt.getSprintIssues(
      team.boardId,
      source.id,
      team.originalEffortField,
      team.currentEffortField,
    );
    const teamIssues = issues
      .map(toEffortIssue)
      .filter((i) => i.assigneeId !== null && i.assigneeId !== undefined && logins.has(i.assigneeId));
    const metrics = computeMetrics(
      entry.capacity,
      teamIssues,
      source.start!,
      source.finish!,
      entry.focusFactor,
    );
    const observed = observedFocusFactor(
      metrics.completedOriginalEffortMinutes,
      metrics.rawCapacityMinutes,
    );
    // Carry forward when nothing could be observed (no team effort or no capacity).
    const carryForward = metrics.originalEffortMinutes === 0 || observed === null;
    return nextFocusFactor(
      { previousFactor: entry.focusFactor, observed, carryForward },
      { learningRate: team.learningRate },
    );
  }

  /** Edit native Sprint details, then resync the team's snapshot (defaults recompute). */
  async patchSprintDetails(
    sprintId: string,
    patch: PatchSprintDetailsRequest,
    teamId?: string,
  ): Promise<SprintView> {
    const team = await this.requireTeam(teamId);
    const current = await this.yt.getSprint(team.boardId, sprintId);
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
    const updated = await this.yt.updateSprint(team.boardId, sprintId, patch);
    if (updated.start !== null && updated.finish !== null) {
      await this.app('POST', 'sprint-register', {
        teamId: team.id,
        sprint: { id: sprintId, name: updated.name, start: updated.start, finish: updated.finish },
      });
    }
    return this.getSprint(sprintId, team.id);
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
      view = await this.getSprint(sprintId, teamId);
      const row = view.team.capacity.rows[login];
      const applied =
        row !== undefined &&
        (body.availableMinutes === undefined || row.availableMinutes === body.availableMinutes) &&
        (body.note === undefined || row.note === body.note);
      if (applied || attempt >= 2) return view;
      expectedRevision = view.team.capacityRevision;
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
    return this.getSprint(sprintId, teamId);
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
      view = await this.getSprint(sprintId, teamId);
      if (view.team.focusFactor === body.newValue || attempt >= 2) return view;
    }
  }

  async excludeFromCalibration(
    sprintId: string,
    teamId: string,
    body: { reason: string },
  ): Promise<SprintView> {
    await this.app('POST', 'calibration', { sprintId, teamId, excluded: true, reason: body.reason });
    return this.getSprint(sprintId, teamId);
  }

  async includeInCalibration(sprintId: string, teamId: string): Promise<SprintView> {
    await this.app('POST', 'calibration', { sprintId, teamId, excluded: false });
    return this.getSprint(sprintId, teamId);
  }
}
