import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Select from '@jetbrains/ring-ui-built/components/select/select';
import type {
  SprintSummary,
  SprintView,
  PatchCapacityRequest,
  IssueView,
  UserPrefs,
} from '../../shared/api';
import type { ProjectConfig, Team } from '../../shared/types';
import { daysToMinutes } from '../../shared/units';
import {
  firstSprintDates,
  nextSprintDates,
  pickRelevantSprint,
  renderSprintName,
  teamMemberLogins,
  utcMsToIso,
} from '../../domain/index';
import { ApiClient, ApiClientError } from '../api-client';
import { CapacityTable, type RowDraft } from '../components/CapacityTable';
import { CapacitySummary } from '../components/CapacitySummary';
import { EffortSummary } from '../components/EffortSummary';
import { DataHealth } from '../components/DataHealth';
import { SprintDetails } from '../components/SprintDetails';
import { IssueDetailsOverlay } from '../components/IssueDetailsOverlay';
import {
  CreateNextSprintDialog,
  type NextSprintPreview,
} from '../components/CreateNextSprintDialog';
import { FocusFactorOverrideDialog } from '../components/FocusFactorOverrideDialog';
import { ConflictBanner } from '../components/ConflictBanner';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { SprintPlanningBoard } from '../components/SprintPlanningBoard';
import { SettingsForm } from '../project-settings/SettingsForm';
import type { CreateNextSprintRequest } from '../../shared/api';

export interface SprintCapacityTabProps {
  client: ApiClient;
}

interface ConflictInfo {
  retry: () => Promise<void>;
}

/**
 * Preview the next Sprint. It is always computed from the LATEST managed Sprint (max
 * sequence), NOT the currently-selected one, because create-next continues after the
 * latest regardless of UI selection. With no managed Sprints yet, it previews the
 * first Sprint starting today. Uses the same domain functions as the create flow, so
 * the preview always matches what will actually be created.
 */
function computePreview(
  team: Team,
  latest: { finish: string; sequence: number } | null,
): NextSprintPreview {
  const dates = latest
    ? nextSprintDates(latest.finish, team.sprintLengthDays)
    : firstSprintDates(utcMsToIso(Date.now()), team.sprintLengthDays);
  const name = renderSprintName(team.nameTemplate, {
    year: Number(dates.start.slice(0, 4)),
    sequence: (latest?.sequence ?? 0) + 1,
    startDate: dates.start,
    finishDate: dates.finish,
  });
  return { name, start: dates.start, finish: dates.finish };
}

function defaultDays(availableMinutes: number, hoursPerDay: number): string {
  return String(Math.round((availableMinutes / (hoursPerDay * 60)) * 100) / 100);
}

/** The team remembered server-side for this project, if any. */
function multiTeamRemembered(prefs: UserPrefs, projectKey: string): string | null {
  return projectKey !== '' ? (prefs.lastTeamByProject?.[projectKey] ?? null) : null;
}

// The widget may run in a sandboxed srcdoc iframe with an opaque origin, where
// touching localStorage THROWS. Remembering the picked project is best-effort:
// without storage the picker simply shows on every open.
function readStoredProject(): string | null {
  try {
    return window.localStorage.getItem('scp.project');
  } catch {
    return null;
  }
}
function storeProject(key: string): void {
  try {
    window.localStorage.setItem('scp.project', key);
  } catch {
    /* opaque origin — not remembered */
  }
}
function clearStoredProject(): void {
  try {
    window.localStorage.removeItem('scp.project');
  } catch {
    /* opaque origin */
  }
}

const sectionStyle: React.CSSProperties = {
  padding: 'calc(var(--ring-unit) * 2)',
  border: '1px solid var(--ring-line-color)',
  borderRadius: 'var(--ring-border-radius)',
  marginBottom: 'calc(var(--ring-unit) * 2)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 calc(var(--ring-unit) * 1.5)',
  font: 'var(--ring-font-smaller-lower)',
  fontWeight: 'bold',
  color: 'var(--ring-secondary-color)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

/**
 * §6 main Sprint capacity screen. Since config v4 the TEAM is the top-level context:
 * each team owns its board, Sprint cadence and settings, so the team switcher swaps
 * the whole planning context (sprint list included), not a slice of a shared Sprint.
 */
export function SprintCapacityTab({ client }: SprintCapacityTabProps): React.JSX.Element {

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [configured, setConfigured] = useState(true);
  // Main-menu placement: the host has no project context, so the planner offers a
  // picker (remembering the last choice) and binds the client to the picked project.
  const pickerCapable = useMemo(() => !client.hostHasProjectContext(), [client]);
  const [needsProject, setNeedsProject] = useState(false);
  const [projectChoices, setProjectChoices] = useState<
    Array<{ id: string; key: string; name: string }>
  >([]);

  const [isManager, setIsManager] = useState(false);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Display names by login (user directory) — capacity rows only cover the SELECTED
  // team, but the assignee picker offers every team's members.
  const [namesByLogin, setNamesByLogin] = useState<Record<string, string>>({});
  // The settings UI is embedded here (managers only) so the app exposes a single
  // project tab rather than a separate "settings" tab. 'settings' shows the config form.
  const [view, setView] = useState<'planner' | 'settings'>('planner');

  const [sprints, setSprints] = useState<SprintSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sprint, setSprint] = useState<SprintView | null>(null);
  // The team all team-scoped sections are bound to (?team= deep-link; first team default).
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // Refs mirror the two selections so load() can read them WITHOUT depending on
  // them: load() also SETS them, and a state dependency would change load's
  // identity and re-trigger the mount effect — the second pass cleared drafts and
  // silently swallowed capacity edits typed right after the planner appeared.
  const selectedIdRef = useRef<string | null>(null);
  const selectedTeamIdRef = useRef<string | null>(null);

  const [issues, setIssues] = useState<IssueView[]>([]);
  const [backlog, setBacklog] = useState<IssueView[]>([]);
  const [assigningIssueIds, setAssigningIssueIds] = useState<ReadonlySet<string>>(new Set());

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [savingUserIds, setSavingUserIds] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [retryingConflict, setRetryingConflict] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  // Double-clicking a board card opens this issue in an in-page overlay over the
  // planner, anchored at the card's document position.
  const [activeIssue, setActiveIssue] = useState<{ issue: IssueView; anchorY: number } | null>(null);

  const teams = config?.teams ?? [];
  const multiTeam = teams.length > 1;

  // The selected team, kept valid against the current config (falls back to team 1).
  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId) ?? teams[0] ?? null,
    [teams, selectedTeamId],
  );
  // Working-hours are a TEAM setting since v4 (teams may run different schedules).
  const hoursPerDay = selectedTeam?.hoursPerDay ?? 8;

  const loadSprint = useCallback(
    async (id: string, clearDrafts: boolean, teamId?: string): Promise<void> => {
      const view = await client.getSprint(id, teamId);
      setSprint(view);
      if (clearDrafts) setDrafts({});
      // Load the Sprint's issues + the team's backlog for the planning board
      // (best-effort; the planner still works if these fail, e.g. on a permission hiccup).
      try {
        const [sprintIssues, backlogIssues] = await Promise.all([
          client.listSprintIssues(id, teamId),
          client.listBacklog(id, teamId).catch(() => [] as IssueView[]),
        ]);
        setIssues(sprintIssues);
        setBacklog(backlogIssues);
      } catch {
        setIssues([]);
        setBacklog([]);
      }
    },
    [client],
  );

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setLoadError(null);
    try {
      // No host project context (main-menu placement): restore the last-picked
      // project or offer the picker before anything project-scoped is fetched.
      if (!client.hasProjectContext()) {
        // A user with no visible projects gets a 403 from the projects endpoint —
        // show the (accurate) "no projects" picker state rather than a raw error.
        // The last-picked project is remembered SERVER-SIDE (per-user prefs — the
        // sandboxed iframe has no reliable localStorage); the local copy is only a
        // fast-path hint.
        const [list, prefs] = await Promise.all([
          client.listProjects().catch(() => []),
          client.getPrefs(),
        ]);
        const storedKey = prefs.lastProjectKey ?? readStoredProject();
        const stored = list.find((p) => p.key === storedKey);
        if (stored !== undefined) {
          client.useProject(stored);
        } else {
          setProjectChoices(list);
          setNeedsProject(true);
          setStatus('ready');
          return;
        }
      }
      setNeedsProject(false);
      const [configResponse, uid, directory] = await Promise.all([
        client.getConfig(),
        client.resolveUserId(),
        client.searchUsers('').catch(() => []),
      ]);
      setCurrentUserId(uid);
      setNamesByLogin(Object.fromEntries(directory.map((u) => [u.login, u.name || u.login])));
      setIsManager(configResponse.isManager);
      if (!configResponse.configured || configResponse.config === null) {
        setConfigured(false);
        setStatus('ready');
        return;
      }
      setConfigured(true);
      setConfig(configResponse.config);
      const params =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();
      // Team first: since v4 the team owns the board and cadence, so the SPRINT LIST
      // depends on the team. ?team= deep-link wins; then the prior selection; then
      // the server-side remembered team; then team 1.
      const configTeams = configResponse.config.teams;
      const requestedTeam = params.get('team');
      const priorTeamId = selectedTeamIdRef.current;
      const rememberedTeamId = multiTeamRemembered(
        await client.getPrefs().catch(() => ({})),
        await client.projectKey().catch(() => ''),
      );
      const nextTeam =
        (requestedTeam !== null && configTeams.find((t) => t.id === requestedTeam)) ||
        (priorTeamId !== null && configTeams.find((t) => t.id === priorTeamId)) ||
        (rememberedTeamId !== null && configTeams.find((t) => t.id === rememberedTeamId)) ||
        configTeams[0] ||
        null;
      selectedTeamIdRef.current = nextTeam?.id ?? null;
      setSelectedTeamId(nextTeam?.id ?? null);
      const list = await client.listSprints(nextTeam?.id);
      setSprints(list);
      // Deep-link support: ?sprint=<id> preselects a Sprint on first load. Sprint
      // ids are only meaningful within the team's board, so the prior selection is
      // validated against THIS team's list.
      const requested = params.get('sprint');
      const preferred =
        (requested !== null && list.find((s) => s.id === requested)) ||
        pickRelevantSprint(list, utcMsToIso(Date.now())) ||
        null;
      const priorId = selectedIdRef.current;
      const nextId = priorId !== null && list.some((s) => s.id === priorId)
        ? priorId
        : preferred?.id ?? null;
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      if (nextId !== null) await loadSprint(nextId, true, nextTeam?.id);
      else setSprint(null);
      setStatus('ready');
    } catch (err) {
      setLoadError(err);
      setStatus('error');
    }
    // Selections are read through refs (set above) so this callback's identity is
    // STABLE — a state dependency here re-ran the mount effect and its second pass
    // cleared capacity drafts mid-typing.
  }, [client, loadSprint]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh: silently re-load the selected Sprint on an interval so metrics stay
  // live as issues change — no manual Refresh needed.
  useEffect(() => {
    if (selectedId === null) return undefined;
    const id = selectedId;
    const teamId = selectedTeam?.id;
    const interval = setInterval(() => {
      void loadSprint(id, false, teamId).catch(() => {
        /* transient poll error; the next tick retries */
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedId, selectedTeam?.id, loadSprint]);

  const selectSprint = useCallback(
    (id: string): void => {
      selectedIdRef.current = id;
      setSelectedId(id);
      setConflict(null);
      setActionError(null);
      void loadSprint(id, true, selectedTeam?.id).catch((err: unknown) => setActionError(err));
    },
    [loadSprint, selectedTeam?.id],
  );

  const selectTeam = useCallback(
    (teamId: string): void => {
      selectedTeamIdRef.current = teamId;
      setSelectedTeamId(teamId);
      setConflict(null);
      setActionError(null);
      setDrafts({});
      // Since v4 the team owns its board and cadence: switching teams means a NEW
      // sprint list — the old selection's sprint id is meaningless on the new board.
      void (async () => {
        try {
          const list = await client.listSprints(teamId);
          setSprints(list);
          const preferred = pickRelevantSprint(list, utcMsToIso(Date.now()));
          selectedIdRef.current = preferred?.id ?? null;
          setSelectedId(preferred?.id ?? null);
          if (preferred) await loadSprint(preferred.id, true, teamId);
          else setSprint(null);
        } catch (err) {
          setActionError(err);
        }
      })();
      // Remember the choice server-side (best-effort) so the planner reopens here.
      void client
        .projectKey()
        .then((key) => client.saveLastTeam(key, teamId))
        .catch(() => {});
    },
    [client, loadSprint],
  );

  const withSaving = useCallback(
    async (userId: string, fn: () => Promise<void>): Promise<void> => {
      setSavingUserIds((prev) => new Set(prev).add(userId));
      try {
        await fn();
      } finally {
        setSavingUserIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    },
    [],
  );

  // Since v4 the fetched view IS the selected team's view.
  const teamView = sprint?.team ?? null;

  const patchCapacity = useCallback(
    async (userId: string, fields: Omit<PatchCapacityRequest, 'expectedRevision'>): Promise<void> => {
      if (sprint === null || teamView === null || selectedTeam === null) return;
      const sprintId = sprint.id;
      const teamId = selectedTeam.id;
      const body: PatchCapacityRequest = { expectedRevision: teamView.capacityRevision, ...fields };
      await withSaving(userId, async () => {
        try {
          const updated =
            userId === currentUserId
              ? await client.patchMyCapacity(sprintId, teamId, body)
              : await client.patchUserCapacity(sprintId, teamId, userId, body);
          setSprint(updated);
          setConflict(null);
          setActionError(null);
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        } catch (err) {
          if (err instanceof ApiClientError && err.isConflict) {
            // Reload latest but preserve the user's typed drafts; offer a retry.
            await loadSprint(sprintId, false, teamId);
            setConflict({ retry: () => patchCapacity(userId, fields) });
          } else {
            setActionError(err);
          }
        }
      });
    },
    [sprint, teamView, selectedTeam, currentUserId, client, withSaving, loadSprint],
  );

  const rows = useMemo(
    () => (teamView === null ? [] : Object.values(teamView.capacity.rows).sort((a, b) =>
      (a.displayNameSnapshot || a.userId).localeCompare(b.displayNameSnapshot || b.userId),
    )),
    [teamView],
  );

  // Split the team's Sprint issues: the team's own work (members + unassigned)
  // versus work assigned to people OUTSIDE the team (visible but planned elsewhere).
  const { teamIssues, outsideIssues } = useMemo(() => {
    if (selectedTeam === null) return { teamIssues: issues, outsideIssues: [] as IssueView[] };
    const logins = teamMemberLogins(selectedTeam);
    const own: IssueView[] = [];
    const outside: IssueView[] = [];
    for (const issue of issues) {
      if (issue.assigneeId === null || logins.has(issue.assigneeId)) own.push(issue);
      else outside.push(issue);
    }
    return { teamIssues: own, outsideIssues: outside };
  }, [issues, selectedTeam]);

  // The "Create next Sprint" preview is always derived from the latest managed Sprint
  // (highest sequence), matching the create flow which continues after the latest
  // regardless of which Sprint is selected in the UI.
  const latestManagedSprint = useMemo<
    { finish: string; sequence: number; unresolvedIssueCount: number } | null
  >(() => {
    const managed = sprints.filter((s) => s.managed);
    if (managed.length === 0) return null;
    const latest = managed.reduce((a, b) => (b.sequence > a.sequence ? b : a));
    return {
      finish: latest.finish,
      sequence: latest.sequence,
      unresolvedIssueCount: latest.unresolvedIssueCount,
    };
  }, [sprints]);

  const updateDraft = useCallback(
    (userId: string, patch: Partial<RowDraft>): void => {
      setDrafts((prev) => {
        const row = teamView?.capacity.rows[userId];
        const base: RowDraft =
          prev[userId] ??
          {
            availableDays: row ? defaultDays(row.availableMinutes, hoursPerDay) : '',
            note: row?.note ?? '',
          };
        return { ...prev, [userId]: { ...base, ...patch } };
      });
    },
    [teamView, hoursPerDay],
  );

  const commitRow = useCallback(
    (userId: string): void => {
      if (teamView === null) return;
      const row = teamView.capacity.rows[userId];
      const draft = drafts[userId];
      if (row === undefined || draft === undefined) return;
      const fields: Omit<PatchCapacityRequest, 'expectedRevision'> = {};
      const parsed = Number(draft.availableDays);
      if (Number.isFinite(parsed) && parsed >= 0) {
        const minutes = daysToMinutes(parsed, hoursPerDay);
        if (minutes !== row.availableMinutes) fields.availableMinutes = minutes;
      }
      if (draft.note !== row.note) fields.note = draft.note;
      if (Object.keys(fields).length === 0) return;
      void patchCapacity(userId, fields);
    },
    [teamView, drafts, hoursPerDay, patchCapacity],
  );

  const handleRetryConflict = useCallback((): void => {
    if (conflict === null) return;
    setRetryingConflict(true);
    void conflict.retry().finally(() => setRetryingConflict(false));
  }, [conflict]);

  const saveDetails = useCallback(
    (patch: Parameters<ApiClient['patchSprintDetails']>[1]): void => {
      if (sprint === null) return;
      const sprintId = sprint.id;
      setSavingDetails(true);
      void client
        .patchSprintDetails(sprintId, patch, selectedTeam?.id)
        .then((updated) => {
          setSprint(updated);
          setActionError(null);
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setSavingDetails(false));
    },
    [sprint, selectedTeam?.id, client],
  );

  const createNextSprint = useCallback(
    (request: CreateNextSprintRequest): void => {
      setCreating(true);
      void client
        .createNextSprint(request, selectedTeam?.id)
        .then((created) => {
          setShowCreate(false);
          setActionError(null);
          void load().then(() => selectSprint(created.id));
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setCreating(false));
    },
    [client, selectedTeam?.id, load, selectSprint],
  );

  const overrideFocusFactor = useCallback(
    (request: { newValue: number; reason: string }): void => {
      if (sprint === null || selectedTeam === null) return;
      const sprintId = sprint.id;
      setOverriding(true);
      void client
        .overrideFocusFactor(sprintId, selectedTeam.id, request)
        .then((updated) => {
          setSprint(updated);
          setShowOverride(false);
          setActionError(null);
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setOverriding(false));
    },
    [sprint, selectedTeam, client],
  );

  const openBoard = useCallback((): void => {
    if (selectedTeam === null) return;
    // Open the TEAM's native agile board in a new tab (the widget's sandboxed iframe
    // blocks top-frame navigation, so window.open is the reliable path). Confirmed on 2025.3.
    window.open(`/agiles/${encodeURIComponent(selectedTeam.boardId)}`, '_blank', 'noopener');
  }, [selectedTeam]);

  // Plan an issue by dragging it on the board: pull into/out of the Sprint + set assignee.
  // The client returns the reconciled SprintView so per-person Load/Remaining refresh
  // immediately; we also reload the Sprint issues + the backlog.
  const planIssue = useCallback(
    (issueId: string, target: { inSprint: boolean; assigneeId: string | null }): void => {
      if (sprint === null) return;
      // GUARD, don't retarget: right after switching the sprint or team the board
      // still renders the previous context for a moment. A drop in that window
      // must be IGNORED — acting on the selection would plan a stale-rendered card
      // into a sprint the user never saw; acting on the view would undo the switch.
      if (selectedIdRef.current !== null && sprint.id !== selectedIdRef.current) return;
      if (
        selectedTeamIdRef.current !== null &&
        sprint.team.teamId !== selectedTeamIdRef.current
      ) {
        return;
      }
      const sprintId = sprint.id;
      const teamId = selectedTeam?.id;
      setAssigningIssueIds((prev) => new Set(prev).add(issueId));
      setActionError(null);
      client
        .planIssue(sprintId, issueId, target, teamId)
        .then(async (updated) => {
          setSprint(updated);
          const [iss, bl] = await Promise.all([
            client.listSprintIssues(sprintId, teamId),
            client.listBacklog(sprintId, teamId).catch(() => backlog),
          ]);
          setIssues(iss);
          setBacklog(bl);
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() =>
          setAssigningIssueIds((prev) => {
            const next = new Set(prev);
            next.delete(issueId);
            return next;
          }),
        );
    },
    [sprint, selectedTeam?.id, client, backlog],
  );

  // Double-click a card: open the issue in an IN-PAGE overlay OVER the planner
  // (dimmed backdrop, anchored at the card so it opens where the user is looking).
  // YouTrack blocks embedding its native issue page in the widget's opaque-origin
  // iframe, so this is the app's own editor driven through the YouTrack REST API in
  // the current user's context (see IssueDetailsOverlay).
  const openIssue = useCallback((issue: IssueView, anchorY: number): void => {
    setActiveIssue({ issue, anchorY });
  }, []);

  // Leaving the embedded settings panel: return to the planner and reload so any
  // configuration change (board, fields, teams) is reflected immediately.
  const closeSettings = useCallback((): void => {
    setView('planner');
    void load();
  }, [load]);

  const pickProject = useCallback(
    (project: { id: string; key: string; name: string }): void => {
      storeProject(project.key);
      void client.saveLastProject(project.key);
      client.useProject(project);
      setNeedsProject(false);
      selectedIdRef.current = null;
      setSelectedId(null);
      setSprint(null);
      void load();
    },
    [client, load],
  );

  const switchProject = useCallback((): void => {
    clearStoredProject();
    void client.saveLastProject(null);
    setStatus('loading');
    void client
      .listProjects()
      .then((list) => {
        setProjectChoices(list);
        setNeedsProject(true);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setLoadError(err);
        setStatus('error');
      });
  }, [client]);

  if (status === 'loading') return <LoadingState message="Loading Sprint capacity…" />;
  if (status === 'error') return <ErrorState error={loadError} onRetry={() => void load()} />;
  // Main-menu placement without a remembered project: pick one first.
  if (needsProject) {
    return (
      <div
        data-test="scp-project-picker"
        style={{ padding: 'calc(var(--ring-unit) * 3)', font: 'var(--ring-font)', maxWidth: 560 }}
      >
        <h1 style={{ marginTop: 0, font: 'var(--ring-font-larger)' }}>Sprint Capacity</h1>
        {projectChoices.length === 0 ? (
          <EmptyState
            title="No projects available"
            description="You don't have access to any projects yet — ask a project admin to add you to a team."
          />
        ) : (
          <>
            <p style={{ color: 'var(--ring-secondary-color)' }}>
              Choose the project you plan capacity for (remembered for next time):
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ring-unit)' }}>
              {projectChoices.map((p) => (
                <Button
                  key={p.id}
                  data-test="scp-project-choice"
                  data-project={p.key}
                  onClick={() => pickProject(p)}
                >
                  {p.name} ({p.key})
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
  // Managers configure the app in-place (single-tab design); the form has its own
  // "Back to planner" control that calls closeSettings.
  if (view === 'settings' && isManager) {
    return <SettingsForm client={client} onClose={closeSettings} />;
  }
  if (!configured) {
    return (
      <EmptyState
        title="Not configured yet"
        description={
          isManager
            ? 'Set up the board, effort fields and team to start planning Sprint capacity.'
            : 'A project manager needs to set up the Sprint Capacity Planner before this tab can be used.'
        }
        action={
          <div style={{ display: 'flex', gap: 'var(--ring-unit)', justifyContent: 'center' }}>
            {isManager ? (
              <Button primary onClick={() => setView('settings')}>
                Configure
              </Button>
            ) : null}
            {pickerCapable ? (
              <Button onClick={switchProject}>Switch project</Button>
            ) : null}
          </div>
        }
      />
    );
  }

  const selectData = sprints.map((s) => ({
    key: s.id,
    label: `${s.name}${s.archived ? ' (archived)' : ''}`,
    id: s.id,
  }));
  const selectedItem = selectData.find((item) => item.key === selectedId) ?? null;
  const teamSelectData = teams.map((t) => ({ key: t.id, label: t.name, id: t.id }));
  const selectedTeamItem = teamSelectData.find((item) => item.key === selectedTeam?.id) ?? null;
  // Assignee candidates for the issue overlay: every team's members (grouped by team
  // when several exist) so handing work to another team's person stays a two-click
  // action even though teams now plan on separate boards. Display names come from
  // the selected team's capacity rows, then the user directory (login otherwise).
  const rowNames = sprint?.team.capacity.rows ?? {};
  const allTeamMembers = teams.flatMap((t) =>
    t.participants.map((p) => ({
      userId: p.userId,
      login: p.userId,
      name: rowNames[p.userId]?.displayNameSnapshot || namesByLogin[p.userId] || p.userId,
      team: multiTeam ? t.name : undefined,
    })),
  );
  const scoped = (title: string): string =>
    multiTeam && selectedTeam !== null ? `${title} — ${selectedTeam.name}` : title;

  return (
    <div
      data-test="scp-ready"
      style={{ padding: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font)' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ring-unit)',
          flexWrap: 'wrap',
          marginBottom: 'calc(var(--ring-unit) * 2)',
        }}
      >
        <h1 style={{ margin: 0, marginRight: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font-larger)' }}>
          Sprint capacity
        </h1>
        {multiTeam ? (
          <span data-test="scp-team-select">
            <Select
              data={teamSelectData}
              selected={selectedTeamItem}
              label="Select a team"
              onSelect={(item) => {
                if (item !== null && typeof item.key === 'string') selectTeam(item.key);
              }}
            />
          </span>
        ) : null}
        <span data-test="scp-sprint-select">
          {/* No filter: sprint lists are short, and the filter input's autofocus
              scrolled the host page down when the popup opened (user-reported bug). */}
          <Select
            data={selectData}
            selected={selectedItem}
            label="Select a Sprint"
            onSelect={(item) => {
              if (item !== null && typeof item.key === 'string') selectSprint(item.key);
            }}
          />
        </span>
        <div style={{ flex: 1 }} />
        {isManager ? (
          <Button primary onClick={() => setShowCreate(true)} disabled={sprint === null}>
            Create next Sprint
          </Button>
        ) : null}
        <Button onClick={openBoard} disabled={selectedTeam === null}>
          Open board
        </Button>
        {isManager ? (
          <Button onClick={() => setView('settings')} title="Configure the Sprint Capacity Planner">
            Settings
          </Button>
        ) : null}
        {pickerCapable ? (
          <Button onClick={switchProject} title="Plan a different project">
            Switch project
          </Button>
        ) : null}
      </header>

      {conflict !== null ? (
        <ConflictBanner
          onRetry={handleRetryConflict}
          onDismiss={() => setConflict(null)}
          retrying={retryingConflict}
        />
      ) : null}
      {actionError !== null ? (
        <div style={{ marginBottom: 'calc(var(--ring-unit) * 2)' }}>
          <ErrorState error={actionError} onRetry={() => setActionError(null)} />
        </div>
      ) : null}

      {sprint === null ? (
        <EmptyState
          title="No Sprint selected"
          description="Select a Sprint above, or create the next one to get started."
        />
      ) : (
        <>
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Details</h2>
            <SprintDetails
              // Remount when the sprint (or team) changes: the form seeds its draft
              // from the sprint ONCE, and a stale draft after a team switch showed
              // the previous team's sprint name/dates (caught on camera by review).
              key={`${selectedTeamId ?? ''}:${sprint.id}`}
              sprint={sprint}
              editable={isManager}
              saving={savingDetails}
              onSave={saveDetails}
            />
          </section>

          <section style={sectionStyle} data-test="scp-capacity-section">
            <h2 style={sectionTitleStyle}>{scoped('Capacity')}</h2>
            <CapacityTable
              rows={rows}
              hoursPerDay={hoursPerDay}
              isManager={isManager}
              currentUserId={currentUserId ?? ''}
              assignedEffort={teamView?.assignedEffort ?? {}}
              drafts={drafts}
              savingUserIds={savingUserIds}
              onAvailableInput={(userId, days) => updateDraft(userId, { availableDays: days })}
              onNoteInput={(userId, note) => updateDraft(userId, { note })}
              onCommit={commitRow}
            />
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>{scoped('Plan work — drag issues onto the team')}</h2>
            <SprintPlanningBoard
              sprintIssues={teamIssues}
              outsideIssues={outsideIssues}
              backlogIssues={backlog}
              lanes={rows.map((r) => ({
                userId: r.userId,
                name: r.displayNameSnapshot || r.userId,
                availableMinutes: r.availableMinutes,
              }))}
              teamName={multiTeam ? selectedTeam?.name ?? null : null}
              plannedCapacityMinutes={teamView?.plannedCapacityMinutes ?? 0}
              hoursPerDay={hoursPerDay}
              isManager={isManager}
              backlogConfigured={(selectedTeam?.backlogQuery ?? '').trim().length > 0}
              busyIssueIds={assigningIssueIds}
              onPlan={planIssue}
              onOpenIssue={openIssue}
            />
          </section>

          {activeIssue !== null ? (
            <IssueDetailsOverlay
              issue={activeIssue.issue}
              client={client}
              teammates={allTeamMembers}
              hoursPerDay={hoursPerDay}
              anchorY={activeIssue.anchorY}
              onClose={() => setActiveIssue(null)}
              // SILENT refresh: a full load() would flip to the loading state,
              // collapse the tall iframe and reset the host scroll to the top —
              // yanking the open overlay out of view after every field edit.
              onChanged={() => {
                if (selectedId !== null) {
                  void loadSprint(selectedId, false, selectedTeam?.id).catch(() => {});
                }
              }}
            />
          ) : null}

          {teamView !== null ? (
            <section style={sectionStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 'calc(var(--ring-unit) * 1.5)',
                }}
              >
                <h2 style={{ ...sectionTitleStyle, margin: 0 }}>{scoped('Capacity summary')}</h2>
                {isManager ? (
                  <Button inline onClick={() => setShowOverride(true)}>
                    Override focus factor
                  </Button>
                ) : null}
              </div>
              <CapacitySummary team={teamView} hoursPerDay={hoursPerDay} />
            </section>
          ) : null}

          {teamView !== null ? (
            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>{scoped('Effort')}</h2>
              <EffortSummary team={teamView} sprint={sprint} hoursPerDay={hoursPerDay} />
            </section>
          ) : null}

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Data health</h2>
            <DataHealth sprint={sprint} />
          </section>
        </>
      )}

      {sprint !== null && selectedTeam !== null ? (
        <CreateNextSprintDialog
          show={showCreate}
          preview={computePreview(selectedTeam, latestManagedSprint)}
          carryOverCount={latestManagedSprint?.unresolvedIssueCount ?? 0}
          teamName={multiTeam ? selectedTeam.name : null}
          creating={creating}
          onCancel={() => setShowCreate(false)}
          onCreate={createNextSprint}
        />
      ) : null}

      {sprint !== null && teamView !== null ? (
        <FocusFactorOverrideDialog
          show={showOverride}
          currentValue={teamView.focusFactor}
          teamName={multiTeam ? teamView.teamName : null}
          saving={overriding}
          onCancel={() => setShowOverride(false)}
          onSubmit={overrideFocusFactor}
        />
      ) : null}
    </div>
  );
}
