import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import Checkbox from '@jetbrains/ring-ui-built/components/checkbox/checkbox';
import Select from '@jetbrains/ring-ui-built/components/select/select';
import type {
  BoardSummary,
  ProjectFieldSummary,
  PutConfigRequest,
  UserSummary,
} from '../../shared/api';
import type { Participant, ProjectConfig, Team } from '../../shared/types';
import { DEFAULT_TEAM_ID, MAX_TEAMS } from '../../shared/types';
import { newTeamId } from '../../domain/index';
import { ApiClient, ApiClientError } from '../api-client';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { ConflictBanner } from '../components/ConflictBanner';

export interface SettingsFormProps {
  client: ApiClient;
  /**
   * When provided, the form renders as an embedded panel inside the planner with a
   * "Back to planner" control that invokes this callback (the planner reloads on return).
   * When omitted, the form renders stand-alone (legacy / testing).
   */
  onClose?: () => void;
}

/** A fresh config. The backlog default is scoped to the project once its key is known. */
function defaultConfig(projectKey: string | null): ProjectConfig {
  return {
    version: 3,
    boardId: '',
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'Sprint {sequence}',
    backlogQuery: projectKey !== null ? `project: ${projectKey} #Unresolved` : '#Unresolved',
    // How fast the Focus Factor learns from finished Sprints (see the explanation below).
    learningRate: 0.3,
    teams: [{ id: DEFAULT_TEAM_ID, name: 'Team 1', participants: [] }],
  };
}

interface Problem {
  path: string;
  message: string;
}

function validate(config: ProjectConfig): Problem[] {
  const problems: Problem[] = [];
  if (config.boardId.trim().length === 0) {
    problems.push({ path: 'boardId', message: 'Select an Agile board.' });
  }
  if (config.originalEffortField.trim().length === 0) {
    problems.push({ path: 'originalEffortField', message: 'Select the Original Effort field.' });
  }
  if (config.currentEffortField.trim().length === 0) {
    problems.push({ path: 'currentEffortField', message: 'Select the Current Effort field.' });
  }
  if (!(config.hoursPerDay > 0)) {
    problems.push({ path: 'hoursPerDay', message: 'Hours per day must be greater than 0.' });
  }
  if (!(config.sprintLengthDays >= 1)) {
    problems.push({ path: 'sprintLengthDays', message: 'Sprint length must be at least 1 day.' });
  }
  if (config.nameTemplate.trim().length === 0) {
    problems.push({ path: 'nameTemplate', message: 'Naming template is required.' });
  }
  if (!(config.learningRate > 0 && config.learningRate <= 1)) {
    problems.push({ path: 'learningRate', message: 'Learning rate must be between 0 and 1.' });
  }
  if (
    config.reminderLeadDays !== undefined &&
    !(Number.isInteger(config.reminderLeadDays) && config.reminderLeadDays >= 0 && config.reminderLeadDays <= 30)
  ) {
    problems.push({
      path: 'reminderLeadDays',
      message: 'Reminder lead must be a whole number of days between 0 and 30.',
    });
  }
  if (config.teams.length === 0) {
    problems.push({ path: 'teams', message: 'At least one team is required.' });
  }
  if (config.teams.length > MAX_TEAMS) {
    problems.push({ path: 'teams', message: `At most ${MAX_TEAMS} teams are supported.` });
  }
  const names = new Set<string>();
  config.teams.forEach((team, t) => {
    if (team.name.trim().length === 0) {
      problems.push({ path: `teams[${t}].name`, message: 'Team name is required.' });
    } else if (names.has(team.name.trim().toLowerCase())) {
      problems.push({ path: `teams[${t}].name`, message: `Duplicate team name "${team.name}".` });
    }
    names.add(team.name.trim().toLowerCase());
    // The same person MAY be in several teams (shared specialist); only duplicates
    // within one team are invalid (addParticipant already prevents those).
    team.participants.forEach((p, i) => {
      if (p.userId.trim().length === 0) {
        problems.push({
          path: `teams[${t}].participants[${i}].userId`,
          message: 'Participant id is required.',
        });
      }
      if (!(p.allocation > 0 && p.allocation <= 1)) {
        problems.push({
          path: `teams[${t}].participants[${i}].allocation`,
          message: 'Allocation must be between 1% and 100%.',
        });
      }
    });
  });
  return problems;
}

const sectionStyle: React.CSSProperties = {
  padding: 'calc(var(--ring-unit) * 2)',
  border: '1px solid var(--ring-line-color)',
  borderRadius: 'var(--ring-border-radius)',
  marginBottom: 'calc(var(--ring-unit) * 2)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 calc(var(--ring-unit) * 2)',
  font: 'var(--ring-font-smaller-lower)',
  fontWeight: 'bold',
  color: 'var(--ring-secondary-color)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  gap: 'calc(var(--ring-unit) * 2)',
  flexWrap: 'wrap',
  marginBottom: 'calc(var(--ring-unit) * 2)',
};

// Each schedule field sits in a min-width box so its label never wraps to two lines.
const fieldBox: React.CSSProperties = { minWidth: 160 };

const cellStyle: React.CSSProperties = {
  padding: 'calc(var(--ring-unit) * 1)',
  borderBottom: '1px solid var(--ring-line-color)',
  textAlign: 'left',
  verticalAlign: 'middle',
};

const helpTextStyle: React.CSSProperties = {
  font: 'var(--ring-font-smaller-lower)',
  color: 'var(--ring-secondary-color)',
  lineHeight: 1.5,
};

interface FieldOption {
  key: string;
  label: string;
  disabled?: boolean;
}

/** §7 project settings form for the Sprint Capacity Planner. */
export function SettingsForm({ client, onClose }: SettingsFormProps): React.JSX.Element {

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isManager, setIsManager] = useState(false);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [projectFields, setProjectFields] = useState<ProjectFieldSummary[]>([]);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [config, setConfig] = useState<ProjectConfig>(() => defaultConfig(null));
  const [revision, setRevision] = useState(0);

  // User directory for the participant picker + a name lookup for existing rows.
  const [userOptions, setUserOptions] = useState<UserSummary[]>([]);
  const [namesById, setNamesById] = useState<Record<string, string>>({});
  const [userSearching, setUserSearching] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [serverProblems, setServerProblems] = useState<Problem[]>([]);
  const [conflict, setConflict] = useState<{ retry: () => Promise<void> } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const problems = useMemo(() => validate(config), [config]);
  const problemFor = useCallback(
    (path: string): string | null => problems.find((p) => p.path === path)?.message ?? null,
    [problems],
  );

  // Participants are keyed by LOGIN (the identity shared by widget, backend and REST).
  const rememberNames = useCallback((users: readonly UserSummary[]): void => {
    if (users.length === 0) return;
    setNamesById((prev) => {
      const next = { ...prev };
      for (const u of users) next[u.login] = u.name || u.login;
      return next;
    });
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setLoadError(null);
    try {
      const [configResponse, boardList, fieldList, directory, key] = await Promise.all([
        client.getConfig(),
        client.getBoards(),
        client.getProjectFields().catch(() => [] as ProjectFieldSummary[]),
        client.searchUsers('').catch(() => [] as UserSummary[]),
        client.projectKey().catch(() => null),
      ]);
      setIsManager(configResponse.isManager);
      setBoards(boardList);
      setProjectFields(fieldList);
      setUserOptions(directory);
      rememberNames(directory);
      setProjectKey(key);
      setRevision(configResponse.configRevision);
      setConfig(configResponse.config ?? defaultConfig(key));
      setStatus('ready');
    } catch (err) {
      setLoadError(err);
      setStatus('error');
    }
  }, [client, rememberNames]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchUsers = useCallback(
    (query: string): void => {
      setUserSearching(true);
      client
        .searchUsers(query)
        .then((users) => {
          setUserOptions(users);
          rememberNames(users);
        })
        .catch(() => setUserOptions([]))
        .finally(() => setUserSearching(false));
    },
    [client, rememberNames],
  );

  const update = useCallback(<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]): void => {
    setSaved(false);
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateTeam = useCallback((index: number, patch: Partial<Team>): void => {
    setSaved(false);
    setConfig((prev) => ({
      ...prev,
      teams: prev.teams.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }, []);

  const addTeam = useCallback((): void => {
    setSaved(false);
    setConfig((prev) => {
      if (prev.teams.length >= MAX_TEAMS) return prev;
      const id = newTeamId(prev.teams.map((t) => t.id));
      const n = prev.teams.length + 1;
      let name = `Team ${n}`;
      const used = new Set(prev.teams.map((t) => t.name.trim().toLowerCase()));
      let suffix = n;
      while (used.has(name.toLowerCase())) name = `Team ${(suffix += 1)}`;
      return { ...prev, teams: [...prev.teams, { id, name, participants: [] }] };
    });
  }, []);

  const removeTeam = useCallback((index: number): void => {
    setSaved(false);
    setConfig((prev) =>
      prev.teams.length <= 1
        ? prev
        : { ...prev, teams: prev.teams.filter((_t, i) => i !== index) },
    );
  }, []);

  const updateParticipant = useCallback(
    (teamIndex: number, index: number, patch: Partial<Participant>): void => {
      setSaved(false);
      setConfig((prev) => ({
        ...prev,
        teams: prev.teams.map((t, ti) =>
          ti === teamIndex
            ? { ...t, participants: t.participants.map((p, i) => (i === index ? { ...p, ...patch } : p)) }
            : t,
        ),
      }));
    },
    [],
  );

  const removeParticipant = useCallback((teamIndex: number, index: number): void => {
    setSaved(false);
    setConfig((prev) => ({
      ...prev,
      teams: prev.teams.map((t, ti) =>
        ti === teamIndex ? { ...t, participants: t.participants.filter((_p, i) => i !== index) } : t,
      ),
    }));
  }, []);

  const addParticipant = useCallback(
    (teamIndex: number, user: UserSummary): void => {
      setSaved(false);
      rememberNames([user]);
      setConfig((prev) => {
        // Shared specialists may join several teams — only reject a duplicate
        // within the SAME team.
        const team = prev.teams[teamIndex];
        if (!team || team.participants.some((p) => p.userId === user.login)) return prev;
        return {
          ...prev,
          teams: prev.teams.map((t, ti) =>
            ti === teamIndex
              ? {
                  ...t,
                  participants: [...t.participants, { userId: user.login, enabled: true, allocation: 1 }],
                }
              : t,
          ),
        };
      });
    },
    [rememberNames],
  );

  const save = useCallback(async (): Promise<void> => {
    if (problems.length > 0) return;
    setSaving(true);
    setActionError(null);
    setServerProblems([]);
    const body: PutConfigRequest = { expectedRevision: revision, config };
    try {
      const response = await client.putConfig(body);
      setRevision(response.configRevision);
      if (response.config !== null) setConfig(response.config);
      setSaved(true);
      setConflict(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.isConflict) {
        try {
          const latest = await client.getConfig();
          setRevision(latest.configRevision);
        } catch {
          /* keep the stale revision; retry will surface a fresh conflict if needed */
        }
        setConflict({ retry: save });
      } else if (err instanceof ApiClientError && err.code === 'VALIDATION_FAILED') {
        const details = err.details as { problems?: Problem[] };
        setServerProblems(Array.isArray(details.problems) ? details.problems : []);
        setActionError(err);
      } else {
        setActionError(err);
      }
    } finally {
      setSaving(false);
    }
  }, [problems, revision, config, client]);

  const handleRetry = useCallback((): void => {
    if (conflict === null) return;
    setRetrying(true);
    void conflict.retry().finally(() => setRetrying(false));
  }, [conflict]);

  if (status === 'loading') return <LoadingState message="Loading settings…" />;
  if (status === 'error') return <ErrorState error={loadError} onRetry={() => void load()} />;
  if (!isManager) {
    return (
      <EmptyState
        title="Insufficient permissions"
        description="Only project managers can change the Sprint Capacity Planner configuration."
        action={
          onClose !== undefined ? (
            <Button onClick={onClose}>Back to planner</Button>
          ) : undefined
        }
      />
    );
  }

  // Boards are pre-filtered to this project; boards with sprints disabled stay
  // visible (so the manager understands why they can't be used) but not selectable.
  const boardData: FieldOption[] = boards.map((b) => ({
    key: b.id,
    label: b.usesSprints ? b.name : `${b.name} · sprints disabled on this board`,
    disabled: !b.usesSprints,
  }));
  const selectedBoard = boardData.find((b) => b.key === config.boardId) ?? null;

  // Effort-field options from the project's custom fields. Period fields come first (the
  // effort fields are periods); the currently-configured value is always present as an
  // option so a hand-set field never disappears from the picker.
  const fieldOption = (f: ProjectFieldSummary): FieldOption => ({
    key: f.name,
    label: f.type ? `${f.name} · ${f.type}` : f.name,
  });
  const sortedFields = [...projectFields].sort((a, b) => {
    const ap = a.type === 'period' ? 0 : 1;
    const bp = b.type === 'period' ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  const fieldOptionsFor = (current: string): FieldOption[] => {
    const opts = sortedFields.map(fieldOption);
    if (current && !opts.some((o) => o.key === current)) opts.unshift({ key: current, label: current });
    return opts;
  };
  const origFieldOptions = fieldOptionsFor(config.originalEffortField);
  const curFieldOptions = fieldOptionsFor(config.currentEffortField);

  const nameFor = (userId: string): string => namesById[userId] ?? userId;
  const multiTeam = config.teams.length > 1;
  const keyExample = projectKey ?? 'KEY';

  // The other teams a login already belongs to (shown as a hint — shared specialists
  // may join several teams; only same-team duplicates are blocked).
  const teamsOfLogin = new Map<string, string[]>();
  for (const team of config.teams) {
    for (const p of team.participants) {
      teamsOfLogin.set(p.userId, [...(teamsOfLogin.get(p.userId) ?? []), team.name]);
    }
  }

  const participantsTable = (team: Team, teamIndex: number): React.JSX.Element => (
    <>
      <table
        style={{ width: '100%', borderCollapse: 'collapse' }}
        aria-label={multiTeam ? `Members of ${team.name}` : 'Team participants'}
      >
        <thead>
          <tr>
            <th style={cellStyle} scope="col">
              Member
            </th>
            <th style={cellStyle} scope="col">
              Allocation
            </th>
            <th style={cellStyle} scope="col">
              Enabled
            </th>
            <th style={cellStyle} scope="col">
              Note
            </th>
            <th style={cellStyle} scope="col">
              <span style={{ position: 'absolute', left: -10000 }}>Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {team.participants.length === 0 ? (
            <tr>
              <td style={{ ...cellStyle, color: 'var(--ring-secondary-color)' }} colSpan={5}>
                No team members yet — add people with the picker below.
              </td>
            </tr>
          ) : (
            team.participants.map((p, index) => (
              <tr key={p.userId}>
                <td style={cellStyle}>
                  <div>{nameFor(p.userId)}</div>
                  <div style={helpTextStyle}>{p.userId}</div>
                </td>
                <td style={cellStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Input
                      aria-label={`Allocation for ${nameFor(p.userId)} (percent)`}
                      type="number"
                      min={1}
                      max={100}
                      step={5}
                      size={InputSize.S}
                      value={String(Math.round((p.allocation ?? 1) * 100))}
                      error={problemFor(`teams[${teamIndex}].participants[${index}].allocation`)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const pct = Number(e.target.value);
                        updateParticipant(teamIndex, index, {
                          allocation: Number.isFinite(pct) ? pct / 100 : p.allocation,
                        });
                      }}
                    />
                    <span aria-hidden>%</span>
                  </div>
                </td>
                <td style={cellStyle}>
                  <Checkbox
                    aria-label={`${nameFor(p.userId)} enabled`}
                    checked={p.enabled}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateParticipant(teamIndex, index, { enabled: e.target.checked })
                    }
                  />
                </td>
                <td style={cellStyle}>
                  <Input
                    aria-label={`Note for ${nameFor(p.userId)}`}
                    size={InputSize.M}
                    value={p.note ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateParticipant(teamIndex, index, { note: e.target.value })
                    }
                  />
                </td>
                <td style={cellStyle}>
                  <Button inline onClick={() => removeParticipant(teamIndex, index)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 'calc(var(--ring-unit) * 2)', maxWidth: 360 }}>
        {/* key: remount after every roster change so the picker never keeps the
            previous selection/filter text (confusing "sticky choice" UX). */}
        <Select
          key={`${team.id}-${team.participants.length}`}
          data={userOptions.map((u) => {
            const elsewhere = (teamsOfLogin.get(u.login) ?? []).filter((n) => n !== team.name);
            const inThisTeam = team.participants.some((p) => p.userId === u.login);
            return {
              key: u.login,
              label: inThisTeam
                ? `${u.name || u.login} (${u.login}) · already in this team`
                : elsewhere.length > 0
                  ? `${u.name || u.login} (${u.login}) · also in ${elsewhere.join(', ')}`
                  : `${u.name || u.login} (${u.login})`,
              disabled: inThisTeam,
              model: u,
            };
          })}
          selected={null}
          label="Add a team member…"
          filter
          loading={userSearching}
          onFilter={(q: string) => searchUsers(q)}
          onSelect={(item) => {
            const model = (item as { model?: UserSummary } | null)?.model;
            if (model) addParticipant(teamIndex, model);
          }}
        />
      </div>
    </>
  );

  return (
    <div
      data-test="scp-settings"
      style={{ padding: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font)', maxWidth: 880 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--ring-unit) * 1.5)',
          marginBottom: 'calc(var(--ring-unit) * 2)',
        }}
      >
        {onClose !== undefined ? (
          <Button onClick={onClose}>← Back to planner</Button>
        ) : null}
        <h1 style={{ margin: 0, font: 'var(--ring-font-larger)' }}>Sprint Capacity Planner settings</h1>
      </div>

      {conflict !== null ? (
        <ConflictBanner
          message="These settings changed elsewhere while you were editing. We refreshed the revision and kept your changes."
          onRetry={handleRetry}
          onDismiss={() => setConflict(null)}
          retrying={retrying}
        />
      ) : null}
      {actionError !== null ? (
        <div style={{ marginBottom: 'calc(var(--ring-unit) * 2)' }}>
          <ErrorState error={actionError} onRetry={() => setActionError(null)} />
        </div>
      ) : null}

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Agile board</h2>
        <Select
          data={boardData}
          selected={selectedBoard}
          label="Select a board"
          filter
          onSelect={(item) => {
            if (item !== null && typeof item.key === 'string') update('boardId', item.key);
          }}
        />
        {problemFor('boardId') !== null ? (
          <p role="alert" style={{ color: 'var(--ring-error-color)', font: 'var(--ring-font-smaller)' }}>
            {problemFor('boardId')}
          </p>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Effort field mapping</h2>
        <p style={{ ...helpTextStyle, marginTop: 0 }}>
          Pick the period fields that hold each issue&rsquo;s planned effort (Original) and
          remaining effort (Current). These drive the effort and &ldquo;what fits&rdquo; numbers.
        </p>
        <div style={fieldRow}>
          <div style={fieldBox}>
            <label style={{ ...helpTextStyle, display: 'block', marginBottom: 4 }}>
              Original Effort field
            </label>
            <Select
              data={origFieldOptions}
              selected={origFieldOptions.find((o) => o.key === config.originalEffortField) ?? null}
              label="Select a field"
              filter
              onSelect={(item) => {
                if (item !== null && typeof item.key === 'string') update('originalEffortField', item.key);
              }}
            />
          </div>
          <div style={fieldBox}>
            <label style={{ ...helpTextStyle, display: 'block', marginBottom: 4 }}>
              Current Effort field
            </label>
            <Select
              data={curFieldOptions}
              selected={curFieldOptions.find((o) => o.key === config.currentEffortField) ?? null}
              label="Select a field"
              filter
              onSelect={(item) => {
                if (item !== null && typeof item.key === 'string') update('currentEffortField', item.key);
              }}
            />
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Schedule</h2>
        <div style={fieldRow}>
          <div style={fieldBox}>
            <Input
              label="Hours per day"
              type="number"
              min={1}
              step={0.5}
              size={InputSize.M}
              value={String(config.hoursPerDay)}
              error={problemFor('hoursPerDay')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                update('hoursPerDay', Number(e.target.value))
              }
            />
          </div>
          <div style={fieldBox}>
            <Input
              label="Sprint length (days)"
              type="number"
              min={1}
              step={1}
              size={InputSize.M}
              value={String(config.sprintLengthDays)}
              error={problemFor('sprintLengthDays')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                update('sprintLengthDays', Number(e.target.value))
              }
            />
          </div>
          <div style={fieldBox}>
            <Input
              label="Availability reminder lead (days)"
              type="number"
              min={0}
              max={30}
              step={1}
              size={InputSize.M}
              value={config.reminderLeadDays === undefined ? '' : String(config.reminderLeadDays)}
              placeholder="App default (3 unless changed)"
              error={problemFor('reminderLeadDays')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const raw = e.target.value.trim();
                update('reminderLeadDays', raw === '' ? undefined : Number(raw));
              }}
            />
            <p style={{ ...helpTextStyle, margin: '4px 0 0' }}>
              Days before a Sprint starts to remind participants who kept the default
              availability. 0 turns reminders off for this project; empty uses the app default.
            </p>
          </div>
        </div>
        <Input
          label="Naming template (placeholders: {year} {sequence} {startDate} {finishDate})"
          size={InputSize.L}
          value={config.nameTemplate}
          error={problemFor('nameTemplate')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            update('nameTemplate', e.target.value)
          }
        />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Planning backlog</h2>
        <p style={{ ...helpTextStyle, marginTop: 0 }}>
          A YouTrack search that defines the backlog you plan from — the pool of issues you can
          drag into a Sprint on the planning board. Issues already in the Sprint are excluded
          automatically. Leave empty to hide the backlog lane. Example:{' '}
          <code>project: {keyExample} State: Open</code>.
          {multiTeam ? ' Teams can override this query below.' : ''}
        </p>
        <Input
          label="Backlog search query"
          size={InputSize.L}
          value={config.backlogQuery}
          placeholder={`project: ${keyExample} #Unresolved`}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            update('backlogQuery', e.target.value)
          }
        />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Focus factor &amp; calibration</h2>
        <div style={{ ...helpTextStyle, marginBottom: 'calc(var(--ring-unit) * 2)' }}>
          <p style={{ marginTop: 0 }}>
            The <strong>Focus factor</strong> is the share of raw capacity a team realistically
            delivers (meetings, support and context-switching eat the rest). Planned capacity =
            raw capacity × focus factor.
          </p>
          <p style={{ margin: 0 }}>
            A brand-new team&rsquo;s first Sprint starts at <strong>75%</strong>. When a Sprint
            finishes, the app measures its <em>observed</em> focus factor (completed original
            effort ÷ raw capacity) and nudges the next Sprint&rsquo;s factor toward it:
          </p>
          <p
            style={{
              margin: 'calc(var(--ring-unit)) 0',
              padding: 'calc(var(--ring-unit))',
              background: 'var(--ring-secondary-background-color)',
              borderRadius: 'var(--ring-border-radius)',
              fontFamily: 'var(--ring-font-family-monospace, monospace)',
            }}
          >
            next = previous + learningRate × (observed − previous)
          </p>
          <p style={{ margin: 0 }}>
            <strong>Learning rate</strong> is how quickly it adapts: <em>0.1</em> reacts slowly and
            stays stable across noisy Sprints; <em>0.5</em> tracks the latest Sprint closely.
            {multiTeam
              ? ' Each team calibrates independently from its own Sprints; the learning rate is shared.'
              : ''}{' '}
            A manager can always override the factor on any individual Sprint.
          </p>
        </div>
        <div style={fieldBox}>
          <Input
            label="Learning rate (0–1)"
            type="number"
            min={0.05}
            max={1}
            step={0.05}
            size={InputSize.M}
            value={String(config.learningRate)}
            error={problemFor('learningRate')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('learningRate', Number(e.target.value))
            }
          />
        </div>
      </section>

      {multiTeam ? (
        // Several small teams planning independently inside shared Sprints: each gets a
        // named card with its own members and an optional backlog override.
        <section style={sectionStyle} data-test="scp-teams">
          <h2 style={sectionTitleStyle}>Teams</h2>
          <p style={{ ...helpTextStyle, marginTop: 0 }}>
            All teams share the project&rsquo;s board and Sprint cadence; each team plans its own
            capacity, focus factor and backlog. A person can be in only one team — someone shared
            between squads joins one team with a lower allocation. Teams that need their own board
            or a different Sprint length belong in separate projects.
          </p>
          {problemFor('teams') !== null ? (
            <p role="alert" style={{ color: 'var(--ring-error-color)', font: 'var(--ring-font-smaller)' }}>
              {problemFor('teams')}
            </p>
          ) : null}
          {config.teams.map((team, teamIndex) => (
            <div
              key={team.id}
              data-test="scp-team-card"
              data-team={team.id}
              style={{
                border: '1px solid var(--ring-line-color)',
                borderRadius: 'var(--ring-border-radius)',
                padding: 'calc(var(--ring-unit) * 2)',
                marginBottom: 'calc(var(--ring-unit) * 2)',
              }}
            >
              <div style={{ display: 'flex', gap: 'calc(var(--ring-unit) * 2)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'calc(var(--ring-unit))' }}>
                <Input
                  label="Team name"
                  size={InputSize.M}
                  value={team.name}
                  error={problemFor(`teams[${teamIndex}].name`)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateTeam(teamIndex, { name: e.target.value })
                  }
                />
                <div style={{ flex: 1 }} />
                <Button onClick={() => removeTeam(teamIndex)} title="Remove this team (Sprint history is kept)">
                  Remove team
                </Button>
              </div>
              <Input
                label="Backlog query override — leave empty to use the project backlog"
                size={InputSize.L}
                value={team.backlogQuery ?? ''}
                placeholder={`project: ${keyExample} Subsystem: {value} #Unresolved`}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateTeam(teamIndex, {
                    backlogQuery: e.target.value.length > 0 ? e.target.value : undefined,
                  })
                }
              />
              <div style={{ marginTop: 'calc(var(--ring-unit) * 2)' }}>
                {participantsTable(team, teamIndex)}
              </div>
            </div>
          ))}
          <Button data-test="scp-add-team" onClick={addTeam} disabled={config.teams.length >= MAX_TEAMS}>
            Add team
          </Button>
        </section>
      ) : (
        // Single team: exactly the familiar flat section — no cards, no name field, no
        // per-team backlog. "Add another team" quietly unlocks the multi-team layout.
        <section style={sectionStyle} data-test="scp-teams">
          <h2 style={sectionTitleStyle}>Team</h2>
          <p style={{ ...helpTextStyle, marginTop: 0 }}>
            Add the people you plan capacity for. Everyone is full-time by default; set a lower
            allocation for part-time members and their capacity scales down to match.
          </p>
          {config.teams[0] !== undefined ? participantsTable(config.teams[0], 0) : null}
          <div style={{ marginTop: 'calc(var(--ring-unit) * 2)' }}>
            <Button data-test="scp-add-team" onClick={addTeam}>
              Add another team
            </Button>
            <p style={{ ...helpTextStyle, margin: '4px 0 0' }}>
              For big projects: split planning into small teams, each with its own members,
              focus factor and backlog filter, inside the same Sprints.
            </p>
          </div>
        </section>
      )}

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Managers</h2>
        <p style={{ color: 'var(--ring-secondary-color)', margin: 0 }}>
          {/* No app-specific permission scheme: the backend checks YouTrack's own
              UPDATE_PROJECT permission (plus the project leader) on every mutation. */}
          Whoever can change this project&rsquo;s settings in YouTrack manages its planning:
          they configure teams{multiTeam ? '' : ' (and can split the project into several)'},
          edit all capacity rows, assign issues and plan Sprints. Everyone else on a team may
          edit only their own availability.
        </p>
      </section>

      {serverProblems.length > 0 ? (
        <ul role="alert" style={{ color: 'var(--ring-error-color)' }}>
          {serverProblems.map((p) => (
            <li key={`${p.path}-${p.message}`}>
              {p.path}: {p.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--ring-unit) * 2)' }}>
        <Button
          primary
          onClick={() => void save()}
          loader={saving}
          disabled={saving || problems.length > 0}
        >
          Save settings
        </Button>
        {problems.length > 0 ? (
          <span style={{ color: 'var(--ring-error-color)', font: 'var(--ring-font-smaller)' }}>
            {problems.length} issue{problems.length === 1 ? '' : 's'} to resolve before saving.
          </span>
        ) : null}
        {saved ? (
          <span
            role="status"
            aria-live="polite"
            style={{ color: 'var(--ring-success-color, #1a936f)', font: 'var(--ring-font-smaller)' }}
          >
            Settings saved.
          </span>
        ) : null}
      </div>
    </div>
  );
}
