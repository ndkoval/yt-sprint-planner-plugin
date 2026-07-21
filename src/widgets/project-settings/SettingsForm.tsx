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
import type { Participant, ProjectConfig } from '../../shared/types';
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

function defaultConfig(): ProjectConfig {
  return {
    version: 2,
    boardId: '',
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    backlogQuery: '#Unresolved',
    // How fast the Focus Factor learns from finished Sprints (see the explanation below).
    learningRate: 0.3,
    participants: [],
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
  config.participants.forEach((p, i) => {
    if (p.userId.trim().length === 0) {
      problems.push({ path: `participants[${i}].userId`, message: 'Participant id is required.' });
    }
    if (!(p.allocation > 0 && p.allocation <= 1)) {
      problems.push({
        path: `participants[${i}].allocation`,
        message: 'Allocation must be between 1% and 100%.',
      });
    }
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
}

/** §7 project settings form for the Sprint Capacity Planner. */
export function SettingsForm({ client, onClose }: SettingsFormProps): React.JSX.Element {

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isManager, setIsManager] = useState(false);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [projectFields, setProjectFields] = useState<ProjectFieldSummary[]>([]);
  const [config, setConfig] = useState<ProjectConfig>(defaultConfig);
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
      const [configResponse, boardList, fieldList, directory] = await Promise.all([
        client.getConfig(),
        client.getBoards(),
        client.getProjectFields().catch(() => [] as ProjectFieldSummary[]),
        client.searchUsers('').catch(() => [] as UserSummary[]),
      ]);
      setIsManager(configResponse.isManager);
      setBoards(boardList);
      setProjectFields(fieldList);
      setUserOptions(directory);
      rememberNames(directory);
      setRevision(configResponse.configRevision);
      setConfig(configResponse.config ?? defaultConfig());
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

  const updateParticipant = useCallback(
    (index: number, patch: Partial<Participant>): void => {
      setSaved(false);
      setConfig((prev) => ({
        ...prev,
        participants: prev.participants.map((p, i) => (i === index ? { ...p, ...patch } : p)),
      }));
    },
    [],
  );

  const removeParticipant = useCallback((index: number): void => {
    setSaved(false);
    setConfig((prev) => ({
      ...prev,
      participants: prev.participants.filter((_p, i) => i !== index),
    }));
  }, []);

  const addParticipant = useCallback(
    (user: UserSummary): void => {
      setSaved(false);
      rememberNames([user]);
      setConfig((prev) => {
        if (prev.participants.some((p) => p.userId === user.login)) return prev;
        return {
          ...prev,
          participants: [...prev.participants, { userId: user.login, enabled: true, allocation: 1 }],
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

  const boardData: FieldOption[] = boards.map((b) => ({ key: b.id, label: b.name }));
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

  // Participant picker: users not already on the team.
  const participantIds = new Set(config.participants.map((p) => p.userId));
  const addOptions = userOptions
    .filter((u) => !participantIds.has(u.login))
    .map((u) => ({ key: u.login, label: `${u.name || u.login} (${u.login})`, model: u }));

  return (
    <div style={{ padding: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font)', maxWidth: 880 }}>
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
          <code>project: AGP State: Open</code>.
        </p>
        <Input
          label="Backlog search query"
          size={InputSize.L}
          value={config.backlogQuery}
          placeholder="#Unresolved"
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
            stays stable across noisy Sprints; <em>0.5</em> tracks the latest Sprint closely. A
            manager can always override the factor on any individual Sprint.
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

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Team</h2>
        <p style={{ ...helpTextStyle, marginTop: 0 }}>
          Add the people you plan capacity for. Everyone is full-time by default; set a lower
          allocation for part-time members and their capacity scales down to match.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Team participants">
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
            {config.participants.length === 0 ? (
              <tr>
                <td style={{ ...cellStyle, color: 'var(--ring-secondary-color)' }} colSpan={5}>
                  No team members yet — add people with the picker below.
                </td>
              </tr>
            ) : (
              config.participants.map((p, index) => (
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
                        error={problemFor(`participants[${index}].allocation`)}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const pct = Number(e.target.value);
                          updateParticipant(index, {
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
                        updateParticipant(index, { enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td style={cellStyle}>
                    <Input
                      aria-label={`Note for ${nameFor(p.userId)}`}
                      size={InputSize.M}
                      value={p.note ?? ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateParticipant(index, { note: e.target.value })
                      }
                    />
                  </td>
                  <td style={cellStyle}>
                    <Button inline onClick={() => removeParticipant(index)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 'calc(var(--ring-unit) * 2)', maxWidth: 360 }}>
          <Select
            data={addOptions}
            selected={null}
            label="Add a team member…"
            filter
            loading={userSearching}
            onFilter={(q: string) => searchUsers(q)}
            onSelect={(item) => {
              const model = (item as { model?: UserSummary } | null)?.model;
              if (model) addParticipant(model);
            }}
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Managers</h2>
        <p style={{ color: 'var(--ring-secondary-color)', margin: 0 }}>
          {/* KNOWN LIMITATION: the Capacity-Managers group is set via configuration/provisioning
              (config.managersGroup); a dedicated group picker in this form is not yet built. */}
          Managers are the project members with configuration permission. They can edit all
          capacity rows, assign issues and Sprint details; other participants may edit only their
          own row.
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
