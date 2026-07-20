/**
 * Assembles the HTTP application: builds per-request services and registers every
 * route from §18. The project id is supplied by the widget via the `projectId` query
 * parameter (the app is project-scoped); the board id comes from the project config.
 *
 * Every mutating route validates its body against a zod schema and enforces
 * authorization server-side before touching state.
 */
import {
  canAssignIssues,
  canChangeCalibration,
  canCreateSprint,
  canEditSettings,
  canOverrideFocusFactor,
  canReadDiagnostics,
  canRecalculate,
  type Principal,
} from '../domain/index.js';
import type {
  ConfigResponse,
  ConfigValidationResponse,
  IssueView,
  ProjectFieldSummary,
  SprintSummary,
  UserSummary,
} from '../shared/api.js';
import {
  planIssueRequestSchema,
  updateIssueRequestSchema,
  capacityRevisionRequestSchema,
  createNextSprintRequestSchema,
  excludeCalibrationRequestSchema,
  overrideFocusFactorRequestSchema,
  patchCapacityRequestSchema,
  patchSprintDetailsRequestSchema,
  putConfigRequestSchema,
} from '../shared/api-schemas.js';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import { resolvePrincipal } from './context.js';
import { AppError, boardPermissionRequired, forbidden, notConfigured, notFound } from './errors.js';
import { createLogger, type Logger } from './diagnostics/logger.js';
import { ConfigRepository } from './repositories/config-repository.js';
import { SprintRepository } from './repositories/sprint-repository.js';
import type { YouTrackClient, YtSprint } from './repositories/youtrack-client.js';
import { CapacityService } from './services/capacity-service.js';
import { ConfigService } from './services/config-service.js';
import { DiagnosticsService } from './services/diagnostics-service.js';
import { ExportImportService } from './services/export-import-service.js';
import { FocusFactorService } from './services/focus-factor-service.js';
import { computeMetrics } from './services/metrics-service.js';
import { ReconciliationService } from './services/reconciliation-service.js';
import { SprintService } from './services/sprint-service.js';
import { toSprintView } from './services/sprint-view.js';
import { ok, Router, type HttpRequest, type HttpResponse } from './http/router.js';

export interface AppDeps {
  client: YouTrackClient;
  clock?: Clock;
  logger?: Logger;
}

/** Everything resolved for one project-scoped request. */
interface ProjectContext {
  projectId: string;
  boardId: string;
  principal: Principal;
  configRepo: ConfigRepository;
  sprintRepo: SprintRepository;
  config: NonNullable<Awaited<ReturnType<ConfigRepository['load']>>['config']>;
  configRevision: number;
}

export function createApp(deps: AppDeps): Router {
  const client = deps.client;
  const clock = deps.clock ?? systemClock;
  const logger = deps.logger ?? createLogger();
  const router = new Router(clock);

  const projectIdOf = (req: HttpRequest): string => {
    const id = req.query.projectId;
    if (!id) throw new AppError('VALIDATION_FAILED', 'projectId query parameter is required.');
    return id;
  };

  /** Resolve principal + config; throws NOT_CONFIGURED if config is missing. */
  const requireContext = async (req: HttpRequest): Promise<ProjectContext> => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    const principal = await resolvePrincipal(client, configRepo);
    const configRecord = await configRepo.load();
    if (!configRecord.config) throw notConfigured();
    return {
      projectId,
      boardId: configRecord.config.boardId,
      principal,
      configRepo,
      sprintRepo: new SprintRepository(client, configRecord.config.boardId),
      config: configRecord.config,
      configRevision: configRecord.revision,
    };
  };

  const loadSprintRecord = async (ctx: ProjectContext, sprintId: string): Promise<YtSprint> => {
    const sprint = await client.getSprint(ctx.boardId, sprintId);
    if (!sprint) throw notFound(`Sprint ${sprintId}`);
    return sprint;
  };

  /**
   * After a mutation, reconcile the Sprint (so capacity-derived metrics are fresh) and
   * return the full {@link SprintView} — the shape the widgets consume. Capacity edits
   * change Raw/Confirmed/Planned capacity, so reconciling here keeps the UI consistent
   * without a manual Recalculate.
   */
  const reconcileAndView = async (ctx: ProjectContext, sprintId: string): Promise<HttpResponse> => {
    const sprint = await loadSprintRecord(ctx, sprintId);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    const reconciliation = new ReconciliationService(client, ctx.sprintRepo, clock);
    const result = await reconciliation.reconcile(record, ctx.config, ctx.boardId, ctx.principal.userId);
    const fresh = await ctx.sprintRepo.load(sprint, ctx.projectId);
    return ok(
      toSprintView(fresh, result.metrics.issuesMissingOriginalEffort, {
        assignedEffort: result.metrics.assignedEffort,
        unassignedEffort: result.metrics.unassignedEffort,
      }),
    );
  };

  // ---- GET /config -------------------------------------------------------------
  router.add('GET', '/config', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    const principal = await resolvePrincipal(client, configRepo);
    const record = await configRepo.load();
    const body: ConfigResponse = {
      configured: record.configured,
      configRevision: record.revision,
      config: record.config,
      isManager: principal.isManager,
    };
    return ok(body);
  });

  // ---- PUT /config -------------------------------------------------------------
  router.add('PUT', '/config', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    const principal = await resolvePrincipal(client, configRepo);
    const parsed = putConfigRequestSchema.parse(req.body);
    const existing = await configRepo.load();
    // First-run bootstrap: manager status is derived from the config, so before any config
    // exists no one would be a manager and the app could never be set up. Allow a board
    // administrator to establish the INITIAL config; after that, only managers may change it.
    // The permission is anchored to THIS request's projectId (never a caller-supplied id):
    // the chosen board must belong to the project being configured, closing an IDOR where a
    // caller bootstraps project A's config using a board they administer in project B.
    let allowed: boolean;
    if (existing.configured) {
      allowed = canEditSettings(principal);
    } else {
      const board = await client.getBoard(parsed.config.boardId);
      const boardInProject = board !== null && board.projectIds.includes(projectId);
      allowed = boardInProject && (await client.canManageBoard(parsed.config.boardId));
    }
    if (!allowed) throw forbidden('Only managers can change settings.');
    const configService = new ConfigService(client, configRepo, projectId);
    const result = await configService.save(parsed.config, parsed.expectedRevision);
    // Persist the Capacity Managers group (drives isManager) alongside the config.
    if (parsed.config.managersGroup) {
      await configRepo.saveManagersGroup(parsed.config.managersGroup);
    }
    // Return the full ConfigResponse (the shape the widget consumes), not just the revision.
    const body: ConfigResponse = {
      configured: true,
      configRevision: result.revision,
      config: parsed.config,
      isManager: principal.isManager,
    };
    return ok(body);
  });

  // ---- GET /config/validation --------------------------------------------------
  router.add('GET', '/config/validation', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    const record = await configRepo.load();
    if (!record.config) {
      const body: ConfigValidationResponse = {
        valid: false,
        problems: [{ path: '', message: 'Not configured.' }],
      };
      return ok(body);
    }
    const problems = await new ConfigService(client, configRepo, projectId).validate(record.config);
    const body: ConfigValidationResponse = { valid: problems.length === 0, problems };
    return ok(body);
  });

  // ---- GET /boards -------------------------------------------------------------
  router.add('GET', '/boards', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    await resolvePrincipal(client, configRepo);
    const boards = await client.listBoards();
    return ok(boards.map((b) => ({ id: b.id, name: b.name, usesSprints: b.usesSprints })));
  });

  // ---- GET /users?query= -------------------------------------------------------
  // User search for the settings participant picker and the assignee dropdown. Available
  // before a config exists (settings first-run), so it does not require project context.
  router.add('GET', '/users', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    await resolvePrincipal(client, configRepo);
    const query = req.query.query ?? '';
    const users = await client.searchUsers(query, 20);
    const body: UserSummary[] = users.map((u) => ({ id: u.id, login: u.login, name: u.name }));
    return ok(body);
  });

  // ---- GET /project-fields -----------------------------------------------------
  // Custom fields on the project, for the effort-field pickers in settings. Also available
  // before a config exists.
  router.add('GET', '/project-fields', async (req) => {
    const projectId = projectIdOf(req);
    const configRepo = new ConfigRepository(client, projectId);
    await resolvePrincipal(client, configRepo);
    const fields = await client.getProjectCustomFields(projectId);
    const body: ProjectFieldSummary[] = fields.map((f) => ({ name: f.name, type: f.type }));
    return ok(body);
  });

  // ---- GET /sprints ------------------------------------------------------------
  router.add('GET', '/sprints', async (req) => {
    const ctx = await requireContext(req);
    const sprints = await client.listSprints(ctx.boardId);
    const managed = await ctx.sprintRepo.loadAllManaged(ctx.projectId);
    const recordById = new Map(managed.map((r) => [r.native.id, r]));
    const summaries: SprintSummary[] = sprints.map((s) => ({
      id: s.id,
      name: s.name,
      start: s.start ?? '',
      finish: s.finish ?? '',
      archived: s.archived,
      managed: recordById.has(s.id),
      sequence: recordById.get(s.id)?.sequence ?? 0,
      unresolvedIssueCount: recordById.get(s.id)?.unresolvedIssueCount ?? 0,
    }));
    return ok(summaries);
  });

  // ---- GET /sprints/:sprintId --------------------------------------------------
  router.add('GET', '/sprints/:sprintId', async (req) => {
    const ctx = await requireContext(req);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    // Compute ALL metrics live from the current issue set so every read reflects the
    // latest state automatically — no manual "Recalculate" needed.
    if (sprint.start && sprint.finish) {
      const issues = await client.getSprintIssues(
        ctx.boardId,
        sprint.id,
        ctx.config.originalEffortField,
        ctx.config.currentEffortField,
      );
      const metrics = computeMetrics(
        record.capacity,
        issues,
        sprint.start,
        sprint.finish,
        record.focusFactor,
      );
      return ok(
        toSprintView(
          record,
          metrics.issuesMissingOriginalEffort,
          { assignedEffort: metrics.assignedEffort, unassignedEffort: metrics.unassignedEffort },
          metrics,
        ),
      );
    }
    return ok(toSprintView(record, []));
  });

  // ---- GET /sprints/:sprintId/issues -------------------------------------------
  // The Sprint's issues with assignee + effort, for the planner's "plan work" table.
  router.add('GET', '/sprints/:sprintId/issues', async (req) => {
    const ctx = await requireContext(req);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const issues = await client.getSprintIssues(
      ctx.boardId,
      sprint.id,
      ctx.config.originalEffortField,
      ctx.config.currentEffortField,
    );
    const body: IssueView[] = issues.map((i) => ({
      id: i.id,
      idReadable: i.idReadable ?? i.id,
      summary: i.summary ?? '',
      assigneeId: i.assigneeId ?? null,
      assigneeName: i.assigneeName ?? null,
      originalEffortMinutes: i.originalEffortMinutes,
      currentEffortMinutes: i.currentEffortMinutes,
      resolved: i.resolved,
    }));
    return ok(body);
  });

  // ---- GET /sprints/:sprintId/backlog ------------------------------------------
  // The planning backlog: issues matching the configured backlog search that are NOT yet in
  // this Sprint. Empty backlogQuery → empty backlog (lane hidden).
  router.add('GET', '/sprints/:sprintId/backlog', async (req) => {
    const ctx = await requireContext(req);
    const query = (ctx.config.backlogQuery ?? '').trim();
    if (query.length === 0) return ok([] as IssueView[]);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const [candidates, sprintIssues] = await Promise.all([
      client.searchIssues(query, ctx.config.originalEffortField, ctx.config.currentEffortField),
      client.getSprintIssues(
        ctx.boardId,
        sprint.id,
        ctx.config.originalEffortField,
        ctx.config.currentEffortField,
      ),
    ]);
    const inSprint = new Set(sprintIssues.map((i) => i.id));
    const body: IssueView[] = candidates
      .filter((i) => !inSprint.has(i.id) && !i.resolved)
      .map((i) => ({
        id: i.id,
        idReadable: i.idReadable ?? i.id,
        summary: i.summary ?? '',
        assigneeId: i.assigneeId ?? null,
        assigneeName: i.assigneeName ?? null,
        originalEffortMinutes: i.originalEffortMinutes,
        currentEffortMinutes: i.currentEffortMinutes,
        resolved: i.resolved,
      }));
    return ok(body);
  });

  // ---- POST /sprints/:sprintId/issues/:issueId/plan ----------------------------
  // The core planning action (a board drag): pull an issue into the Sprint (or send it back
  // to the backlog) and set its assignee, in one move. Manager-only; returns the reconciled
  // SprintView so capacity load/remaining refresh.
  router.add('POST', '/sprints/:sprintId/issues/:issueId/plan', async (req) => {
    const ctx = await requireContext(req);
    if (!canAssignIssues(ctx.principal)) throw forbidden('Only managers can plan issues.');
    const parsed = planIssueRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const issueId = req.params.issueId!;
    const current = await client.getSprintIssues(
      ctx.boardId,
      sprint.id,
      ctx.config.originalEffortField,
      ctx.config.currentEffortField,
    );
    const alreadyInSprint = current.some((i) => i.id === issueId);
    if (parsed.inSprint) {
      if (!alreadyInSprint) await client.addIssueToSprint(ctx.boardId, sprint.id, issueId);
      await client.setIssueAssignee(issueId, parsed.assigneeId);
    } else if (alreadyInSprint) {
      await client.removeIssueFromSprint(ctx.boardId, sprint.id, issueId);
    }
    return reconcileAndView(ctx, sprint.id);
  });

  // ---- PATCH /sprints/:sprintId/issues/:issueId -------------------------------
  // Adjust an issue directly from the planner's issue dialog (Original/Current Effort +
  // assignee). Manager-only, and scoped to the managed Sprint: the issue must currently be in
  // this Sprint (so this can never mutate an arbitrary issue). Returns the reconciled SprintView.
  router.add('PATCH', '/sprints/:sprintId/issues/:issueId', async (req) => {
    const ctx = await requireContext(req);
    if (!canAssignIssues(ctx.principal)) throw forbidden('Only managers can edit issues.');
    const parsed = updateIssueRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const issueId = req.params.issueId!;
    const current = await client.getSprintIssues(
      ctx.boardId,
      sprint.id,
      ctx.config.originalEffortField,
      ctx.config.currentEffortField,
    );
    if (!current.some((i) => i.id === issueId)) {
      throw notFound('Issue is not in this Sprint.');
    }
    if (parsed.originalEffortMinutes !== undefined) {
      await client.setIssueEffort(issueId, ctx.config.originalEffortField, parsed.originalEffortMinutes);
    }
    if (parsed.currentEffortMinutes !== undefined) {
      await client.setIssueEffort(issueId, ctx.config.currentEffortField, parsed.currentEffortMinutes);
    }
    if (parsed.assigneeId !== undefined) {
      await client.setIssueAssignee(issueId, parsed.assigneeId);
    }
    return reconcileAndView(ctx, sprint.id);
  });

  // ---- POST /sprints/create-next ----------------------------------------------
  router.add('POST', '/sprints/create-next', async (req) => {
    const ctx = await requireContext(req);
    const hasBoardPermission = await client.canManageBoard(ctx.boardId);
    if (!canCreateSprint(ctx.principal, hasBoardPermission)) {
      if (!hasBoardPermission) throw boardPermissionRequired();
      throw forbidden('Only managers can create Sprints.');
    }
    const parsed = createNextSprintRequestSchema.parse(req.body);
    const reconciliation = new ReconciliationService(client, ctx.sprintRepo, clock);
    const sprintService = new SprintService(client, ctx.sprintRepo, reconciliation, clock);
    const result = await sprintService.createNext(
      ctx.config,
      ctx.boardId,
      ctx.projectId,
      parsed.goal ?? '',
      parsed.moveUnresolvedIssues,
    );
    logger.info({
      correlationId: 'create-next',
      timestamp: clock.now(),
      operation: 'sprints.create-next',
      userId: ctx.principal.userId,
      projectId: ctx.projectId,
      sprintId: result.sprint.id,
      context: { sequence: result.sequence, resumed: result.resumed },
    });
    const record = await ctx.sprintRepo.load(result.sprint, ctx.projectId);
    return ok(toSprintView(record, []));
  });

  // ---- PATCH /sprints/:sprintId/details ---------------------------------------
  router.add('PATCH', '/sprints/:sprintId/details', async (req) => {
    const ctx = await requireContext(req);
    const hasBoardPermission = await client.canManageBoard(ctx.boardId);
    if (!canCreateSprint(ctx.principal, hasBoardPermission)) {
      if (!hasBoardPermission) throw boardPermissionRequired();
      throw forbidden('Only managers can edit Sprint details.');
    }
    const parsed = patchSprintDetailsRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const reconciliation = new ReconciliationService(client, ctx.sprintRepo, clock);
    const sprintService = new SprintService(client, ctx.sprintRepo, reconciliation, clock);
    const updated = await sprintService.patchDetails(ctx.boardId, sprint.id, parsed, sprint);
    // Date changes recompute default capacity; reconcile to refresh metrics.
    const record = await ctx.sprintRepo.load(updated, ctx.projectId);
    const result = await reconciliation.reconcile(record, ctx.config, ctx.boardId, ctx.principal.userId);
    const fresh = await ctx.sprintRepo.load(
      (await client.getSprint(ctx.boardId, sprint.id))!,
      ctx.projectId,
    );
    return ok(
      toSprintView(fresh, result.metrics.issuesMissingOriginalEffort, {
        assignedEffort: result.metrics.assignedEffort,
        unassignedEffort: result.metrics.unassignedEffort,
      }),
    );
  });

  // ---- Capacity mutations ------------------------------------------------------
  const patchCapacity = async (
    req: HttpRequest,
    resolveTarget: (ctx: ProjectContext) => string,
  ): Promise<HttpResponse> => {
    const ctx = await requireContext(req);
    const parsed = patchCapacityRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    if (!record.capacity) throw notFound('Capacity document');
    const service = new CapacityService(ctx.sprintRepo, clock);
    await service.applyPatch(
      sprint.id,
      record.capacity,
      record.capacityRevision,
      parsed.expectedRevision,
      resolveTarget(ctx),
      ctx.principal,
      {
        ...(parsed.availableMinutes !== undefined
          ? { availableMinutes: parsed.availableMinutes }
          : {}),
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      },
    );
    return reconcileAndView(ctx, sprint.id);
  };

  router.add('PATCH', '/sprints/:sprintId/capacity/me', (req) =>
    patchCapacity(req, (ctx) => ctx.principal.userId),
  );
  router.add('PATCH', '/sprints/:sprintId/capacity/:userId', (req) =>
    patchCapacity(req, () => req.params.userId!),
  );

  router.add('POST', '/sprints/:sprintId/capacity/:userId/reset', async (req) => {
    const ctx = await requireContext(req);
    const parsed = capacityRevisionRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    if (!record.capacity) throw notFound('Capacity document');
    const service = new CapacityService(ctx.sprintRepo, clock);
    await service.resetRow(
      sprint.id,
      record.capacity,
      record.capacityRevision,
      parsed.expectedRevision,
      req.params.userId!,
      ctx.principal,
    );
    return reconcileAndView(ctx, sprint.id);
  });

  // ---- POST /sprints/:sprintId/recalculate ------------------------------------
  router.add('POST', '/sprints/:sprintId/recalculate', async (req) => {
    const ctx = await requireContext(req);
    if (!canRecalculate(ctx.principal)) throw forbidden('Only managers can recalculate.');
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    const reconciliation = new ReconciliationService(client, ctx.sprintRepo, clock);
    const result = await reconciliation.reconcile(record, ctx.config, ctx.boardId, ctx.principal.userId);
    const fresh = await ctx.sprintRepo.load(sprint, ctx.projectId);
    return ok(
      toSprintView(fresh, result.metrics.issuesMissingOriginalEffort, {
        assignedEffort: result.metrics.assignedEffort,
        unassignedEffort: result.metrics.unassignedEffort,
      }),
    );
  });

  // ---- POST /sprints/:sprintId/focus-factor/override --------------------------
  router.add('POST', '/sprints/:sprintId/focus-factor/override', async (req) => {
    const ctx = await requireContext(req);
    if (!canOverrideFocusFactor(ctx.principal)) throw forbidden('Only managers can override.');
    const parsed = overrideFocusFactorRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    const service = new FocusFactorService(ctx.sprintRepo, clock);
    await service.override(record, parsed.reason, parsed.newValue, ctx.principal.userId);
    return reconcileAndView(ctx, sprint.id);
  });

  // ---- Calibration exclude/include --------------------------------------------
  router.add('POST', '/sprints/:sprintId/calibration/exclude', async (req) => {
    const ctx = await requireContext(req);
    if (!canChangeCalibration(ctx.principal)) throw forbidden('Only managers can change calibration.');
    const parsed = excludeCalibrationRequestSchema.parse(req.body);
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    await new FocusFactorService(ctx.sprintRepo, clock).setCalibration(record, true, parsed.reason);
    return reconcileAndView(ctx, sprint.id);
  });
  router.add('POST', '/sprints/:sprintId/calibration/include', async (req) => {
    const ctx = await requireContext(req);
    if (!canChangeCalibration(ctx.principal)) throw forbidden('Only managers can change calibration.');
    const sprint = await loadSprintRecord(ctx, req.params.sprintId!);
    const record = await ctx.sprintRepo.load(sprint, ctx.projectId);
    await new FocusFactorService(ctx.sprintRepo, clock).setCalibration(record, false, '');
    return reconcileAndView(ctx, sprint.id);
  });

  // ---- GET /diagnostics --------------------------------------------------------
  router.add('GET', '/diagnostics', async (req) => {
    const ctx = await requireContext(req);
    if (!canReadDiagnostics(ctx.principal)) throw forbidden('Only managers can read diagnostics.');
    const service = new DiagnosticsService(ctx.sprintRepo);
    return ok(await service.summary(ctx.projectId, `diag-${clock.now().toString(36)}`));
  });

  // ---- GET /export -------------------------------------------------------------
  router.add('GET', '/export', async (req) => {
    const ctx = await requireContext(req);
    if (!canReadDiagnostics(ctx.principal)) throw forbidden('Only managers can export.');
    const service = new ExportImportService(ctx.configRepo, ctx.sprintRepo, ctx.projectId);
    return ok(await service.exportBundle(clock.now()));
  });

  // ---- POST /import ------------------------------------------------------------
  router.add('POST', '/import', async (req) => {
    const ctx = await requireContext(req);
    if (!canEditSettings(ctx.principal)) throw forbidden('Only managers can import.');
    const dryRun = req.query.dryRun === 'true';
    const service = new ExportImportService(ctx.configRepo, ctx.sprintRepo, ctx.projectId);
    return ok(await service.importBundle(req.body, dryRun));
  });

  return router;
}
