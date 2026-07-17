import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import Checkbox from '@jetbrains/ring-ui-built/components/checkbox/checkbox';
import Select from '@jetbrains/ring-ui-built/components/select/select';
import type { BoardSummary, PutConfigRequest } from '../../shared/api';
import type { Participant, ProjectConfig } from '../../shared/types';
import { ApiClient, ApiClientError } from '../api-client';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { ConflictBanner } from '../components/ConflictBanner';

export interface SettingsFormProps {
  client?: ApiClient;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultConfig(): ProjectConfig {
  return {
    version: 1,
    boardId: '',
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    firstSprintStart: todayIso(),
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    bootstrapFocusFactor: 0.7,
    learningRate: 0.3,
    maxFactorStep: 0.1,
    minFocusFactor: 0.3,
    maxFocusFactor: 0.9,
    participants: [],
  };
}

interface Problem {
  path: string;
  message: string;
}

const FRACTION_FIELDS: Array<{
  key: keyof ProjectConfig;
  label: string;
}> = [
  { key: 'bootstrapFocusFactor', label: 'Bootstrap focus factor (0–1)' },
  { key: 'learningRate', label: 'Learning rate (0–1)' },
  { key: 'maxFactorStep', label: 'Max factor step (0–1)' },
  { key: 'minFocusFactor', label: 'Min focus factor (0–1)' },
  { key: 'maxFocusFactor', label: 'Max focus factor (0–1)' },
];

function validate(config: ProjectConfig): Problem[] {
  const problems: Problem[] = [];
  if (config.boardId.trim().length === 0) {
    problems.push({ path: 'boardId', message: 'Select an Agile board.' });
  }
  if (config.originalEffortField.trim().length === 0) {
    problems.push({ path: 'originalEffortField', message: 'Original Effort field is required.' });
  }
  if (config.currentEffortField.trim().length === 0) {
    problems.push({ path: 'currentEffortField', message: 'Current Effort field is required.' });
  }
  if (!(config.hoursPerDay > 0)) {
    problems.push({ path: 'hoursPerDay', message: 'Hours per day must be greater than 0.' });
  }
  if (!(config.sprintLengthDays >= 1)) {
    problems.push({ path: 'sprintLengthDays', message: 'Sprint length must be at least 1 day.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.firstSprintStart)) {
    problems.push({ path: 'firstSprintStart', message: 'Enter a valid first-Sprint start date.' });
  }
  if (config.nameTemplate.trim().length === 0) {
    problems.push({ path: 'nameTemplate', message: 'Naming template is required.' });
  }
  for (const { key, label } of FRACTION_FIELDS) {
    const value = config[key] as number;
    if (!(value >= 0 && value <= 1)) {
      problems.push({ path: key, message: `${label} must be between 0 and 1.` });
    }
  }
  if (config.minFocusFactor > config.maxFocusFactor) {
    problems.push({
      path: 'minFocusFactor',
      message: 'Min focus factor must not exceed max focus factor.',
    });
  }
  config.participants.forEach((p, i) => {
    if (p.userId.trim().length === 0) {
      problems.push({ path: `participants[${i}].userId`, message: 'Participant id is required.' });
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

const cellStyle: React.CSSProperties = {
  padding: 'calc(var(--ring-unit) * 1)',
  borderBottom: '1px solid var(--ring-line-color)',
  textAlign: 'left',
  verticalAlign: 'middle',
};

/** §7 project settings form for the Sprint Capacity Planner. */
export function SettingsForm({ client: injected }: SettingsFormProps): React.JSX.Element {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isManager, setIsManager] = useState(false);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [config, setConfig] = useState<ProjectConfig>(defaultConfig);
  const [revision, setRevision] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [serverProblems, setServerProblems] = useState<Problem[]>([]);
  const [conflict, setConflict] = useState<{ retry: () => Promise<void> } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [newParticipantId, setNewParticipantId] = useState('');

  const problems = useMemo(() => validate(config), [config]);
  const problemFor = useCallback(
    (path: string): string | null => problems.find((p) => p.path === path)?.message ?? null,
    [problems],
  );

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setLoadError(null);
    try {
      const [configResponse, boardList] = await Promise.all([
        client.getConfig(),
        client.getBoards(),
      ]);
      setIsManager(configResponse.isManager);
      setBoards(boardList);
      setRevision(configResponse.configRevision);
      setConfig(configResponse.config ?? defaultConfig());
      setStatus('ready');
    } catch (err) {
      setLoadError(err);
      setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const addParticipant = useCallback((): void => {
    const userId = newParticipantId.trim();
    if (userId.length === 0) return;
    setSaved(false);
    setConfig((prev) => ({
      ...prev,
      participants: [...prev.participants, { userId, enabled: true }],
    }));
    setNewParticipantId('');
  }, [newParticipantId]);

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
        // Reload the latest revision but keep the manager's in-progress edits.
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
      />
    );
  }

  const boardData = boards.map((b) => ({ key: b.id, label: b.name, id: b.id }));
  const selectedBoard = boardData.find((b) => b.key === config.boardId) ?? null;

  return (
    <div style={{ padding: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font)', maxWidth: 880 }}>
      <h1 style={{ marginTop: 0, font: 'var(--ring-font-larger)' }}>Sprint Capacity Planner settings</h1>

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
        <div style={fieldRow}>
          <Input
            label="Original Effort field"
            size={InputSize.L}
            value={config.originalEffortField}
            error={problemFor('originalEffortField')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('originalEffortField', e.target.value)
            }
          />
          <Input
            label="Current Effort field"
            size={InputSize.L}
            value={config.currentEffortField}
            error={problemFor('currentEffortField')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('currentEffortField', e.target.value)
            }
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Schedule</h2>
        <div style={fieldRow}>
          <Input
            label="Hours per day"
            type="number"
            min={1}
            step={0.5}
            size={InputSize.S}
            value={String(config.hoursPerDay)}
            error={problemFor('hoursPerDay')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('hoursPerDay', Number(e.target.value))
            }
          />
          <Input
            label="Sprint length (days)"
            type="number"
            min={1}
            step={1}
            size={InputSize.S}
            value={String(config.sprintLengthDays)}
            error={problemFor('sprintLengthDays')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('sprintLengthDays', Number(e.target.value))
            }
          />
          <Input
            label="First Sprint start"
            type="date"
            value={config.firstSprintStart}
            error={problemFor('firstSprintStart')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              update('firstSprintStart', e.target.value)
            }
          />
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
        <h2 style={sectionTitleStyle}>Focus factor</h2>
        <div style={fieldRow}>
          {FRACTION_FIELDS.map(({ key, label }) => (
            <Input
              key={key}
              label={label}
              type="number"
              min={0}
              max={1}
              step={0.05}
              size={InputSize.S}
              value={String(config[key] as number)}
              error={problemFor(key)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                update(key, Number(e.target.value) as ProjectConfig[typeof key])
              }
            />
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Team</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Team participants">
          <thead>
            <tr>
              <th style={cellStyle} scope="col">
                User id
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
                <td style={cellStyle} colSpan={4}>
                  <span style={{ color: 'var(--ring-secondary-color)' }}>
                    No participants yet. Add one below.
                  </span>
                </td>
              </tr>
            ) : (
              config.participants.map((p, index) => (
                <tr key={`${p.userId}-${index}`}>
                  <td style={cellStyle}>
                    <Input
                      aria-label={`Participant ${index + 1} user id`}
                      size={InputSize.M}
                      value={p.userId}
                      error={problemFor(`participants[${index}].userId`)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateParticipant(index, { userId: e.target.value })
                      }
                    />
                  </td>
                  <td style={cellStyle}>
                    <Checkbox
                      aria-label={`Participant ${index + 1} enabled`}
                      checked={p.enabled}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateParticipant(index, { enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td style={cellStyle}>
                    <Input
                      aria-label={`Participant ${index + 1} note`}
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
        <div style={{ display: 'flex', gap: 'var(--ring-unit)', marginTop: 'calc(var(--ring-unit) * 2)' }}>
          <Input
            label="Add participant by user id"
            size={InputSize.M}
            value={newParticipantId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewParticipantId(e.target.value)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') addParticipant();
            }}
          />
          <Button onClick={addParticipant} disabled={newParticipantId.trim().length === 0}>
            Add
          </Button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Managers</h2>
        <p style={{ color: 'var(--ring-secondary-color)', margin: 0 }}>
          {/* SPIKE: confirm host API — managers are derived from the project role/group
              granting configuration rights; there is no managers list in ProjectConfig. */}
          Managers are the project members with configuration permission. They can edit all
          capacity rows and Sprint details; other participants may edit only their own row.
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
