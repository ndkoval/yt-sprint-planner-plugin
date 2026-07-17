import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Select from '@jetbrains/ring-ui-built/components/select/select';
import type { SprintSummary, SprintView, PatchCapacityRequest } from '../../shared/api';
import type { ProjectConfig } from '../../shared/types';
import { daysToMinutes } from '../../shared/units';
import { ApiClient, ApiClientError } from '../api-client';
import { CapacityTable, type RowDraft } from '../components/CapacityTable';
import { CapacitySummary } from '../components/CapacitySummary';
import { EffortSummary } from '../components/EffortSummary';
import { DataHealth } from '../components/DataHealth';
import { SprintDetails } from '../components/SprintDetails';
import {
  CreateNextSprintDialog,
  type NextSprintPreview,
} from '../components/CreateNextSprintDialog';
import { FocusFactorOverrideDialog } from '../components/FocusFactorOverrideDialog';
import { ConflictBanner } from '../components/ConflictBanner';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type { CreateNextSprintRequest, OverrideFocusFactorRequest } from '../../shared/api';

export interface SprintCapacityTabProps {
  client?: ApiClient;
}

interface ConflictInfo {
  retry: () => Promise<void>;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Preview the next Sprint. It is always computed from the LATEST managed Sprint (max
 * sequence), NOT the currently-selected one, because the backend creates the next
 * Sprint after the latest regardless of UI selection. With no managed Sprints yet, it
 * previews the first Sprint from the configured start date.
 */
function computePreview(
  config: ProjectConfig,
  latest: { finish: string; sequence: number } | null,
): NextSprintPreview {
  const start = latest ? addDays(latest.finish, 1) : config.firstSprintStart;
  const finish = addDays(start, Math.max(0, config.sprintLengthDays - 1));
  const nextSequence = (latest?.sequence ?? 0) + 1;
  // Mirror the backend renderSprintName placeholders exactly ({year}/{sequence}/
  // {startDate}/{finishDate}) so this preview matches the name the backend will
  // actually create. See src/domain/sprint/naming.ts.
  const name = config.nameTemplate
    .replace(/\{year\}/g, start.slice(0, 4))
    .replace(/\{sequence\}/g, String(nextSequence))
    .replace(/\{startDate\}/g, start)
    .replace(/\{finishDate\}/g, finish);
  return { name, start, finish };
}

function defaultDays(availableMinutes: number, hoursPerDay: number): string {
  return String(Math.round((availableMinutes / (hoursPerDay * 60)) * 100) / 100);
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

/** §6 main Sprint capacity screen. */
export function SprintCapacityTab({ client: injected }: SprintCapacityTabProps): React.JSX.Element {
  const client = useMemo(() => injected ?? new ApiClient(), [injected]);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [configured, setConfigured] = useState(true);

  const [isManager, setIsManager] = useState(false);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [sprints, setSprints] = useState<SprintSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sprint, setSprint] = useState<SprintView | null>(null);

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
  const [recalculating, setRecalculating] = useState(false);

  const hoursPerDay = config?.hoursPerDay ?? 8;

  const loadSprint = useCallback(
    async (id: string, clearDrafts: boolean): Promise<void> => {
      const view = await client.getSprint(id);
      setSprint(view);
      if (clearDrafts) setDrafts({});
    },
    [client],
  );

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setLoadError(null);
    try {
      const [configResponse, uid] = await Promise.all([
        client.getConfig(),
        client.resolveUserId(),
      ]);
      setCurrentUserId(uid);
      setIsManager(configResponse.isManager);
      if (!configResponse.configured || configResponse.config === null) {
        setConfigured(false);
        setStatus('ready');
        return;
      }
      setConfigured(true);
      setConfig(configResponse.config);
      const list = await client.listSprints();
      setSprints(list);
      // Deep-link support: ?sprint=<id> preselects a Sprint on first load.
      const requested =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('sprint')
          : null;
      const preferred =
        (requested !== null && list.find((s) => s.id === requested)) ||
        list.find((s) => !s.archived && s.managed) ||
        list[0] ||
        null;
      const nextId = selectedId !== null && list.some((s) => s.id === selectedId)
        ? selectedId
        : preferred?.id ?? null;
      setSelectedId(nextId);
      if (nextId !== null) await loadSprint(nextId, true);
      else setSprint(null);
      setStatus('ready');
    } catch (err) {
      setLoadError(err);
      setStatus('error');
    }
  }, [client, loadSprint, selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectSprint = useCallback(
    (id: string): void => {
      setSelectedId(id);
      setConflict(null);
      setActionError(null);
      void loadSprint(id, true).catch((err: unknown) => setActionError(err));
    },
    [loadSprint],
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

  const patchCapacity = useCallback(
    async (userId: string, fields: Omit<PatchCapacityRequest, 'expectedRevision'>): Promise<void> => {
      if (sprint === null) return;
      const sprintId = sprint.id;
      const body: PatchCapacityRequest = { expectedRevision: sprint.capacityRevision, ...fields };
      await withSaving(userId, async () => {
        try {
          const updated =
            userId === currentUserId
              ? await client.patchMyCapacity(sprintId, body)
              : await client.patchUserCapacity(sprintId, userId, body);
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
            await loadSprint(sprintId, false);
            setConflict({ retry: () => patchCapacity(userId, fields) });
          } else {
            setActionError(err);
          }
        }
      });
    },
    [sprint, currentUserId, client, withSaving, loadSprint],
  );

  const rows = useMemo(
    () => (sprint === null ? [] : Object.values(sprint.capacity.rows).sort((a, b) =>
      (a.displayNameSnapshot || a.loginSnapshot).localeCompare(b.displayNameSnapshot || b.loginSnapshot),
    )),
    [sprint],
  );

  // The "Create next Sprint" preview is always derived from the latest managed Sprint
  // (highest sequence), matching the backend which creates after the latest regardless
  // of which Sprint is selected in the UI.
  const latestManagedSprint = useMemo<{ finish: string; sequence: number } | null>(() => {
    const managed = sprints.filter((s) => s.managed);
    if (managed.length === 0) return null;
    const latest = managed.reduce((a, b) => (b.sequence > a.sequence ? b : a));
    return { finish: latest.finish, sequence: latest.sequence };
  }, [sprints]);

  const updateDraft = useCallback(
    (userId: string, patch: Partial<RowDraft>): void => {
      setDrafts((prev) => {
        const row = sprint?.capacity.rows[userId];
        const base: RowDraft =
          prev[userId] ??
          {
            availableDays: row ? defaultDays(row.availableMinutes, hoursPerDay) : '',
            note: row?.note ?? '',
          };
        return { ...prev, [userId]: { ...base, ...patch } };
      });
    },
    [sprint, hoursPerDay],
  );

  const commitRow = useCallback(
    (userId: string): void => {
      if (sprint === null) return;
      const row = sprint.capacity.rows[userId];
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
    [sprint, drafts, hoursPerDay, patchCapacity],
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
        .patchSprintDetails(sprintId, patch)
        .then((updated) => {
          setSprint(updated);
          setActionError(null);
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setSavingDetails(false));
    },
    [sprint, client],
  );

  const recalculate = useCallback((): void => {
    if (sprint === null) return;
    const sprintId = sprint.id;
    setRecalculating(true);
    void client
      .recalculate(sprintId)
      .then((updated) => setSprint(updated))
      .catch((err: unknown) => setActionError(err))
      .finally(() => setRecalculating(false));
  }, [sprint, client]);

  const createNextSprint = useCallback(
    (request: CreateNextSprintRequest): void => {
      setCreating(true);
      void client
        .createNextSprint(request)
        .then((created) => {
          setShowCreate(false);
          setActionError(null);
          void load().then(() => selectSprint(created.id));
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setCreating(false));
    },
    [client, load, selectSprint],
  );

  const overrideFocusFactor = useCallback(
    (request: OverrideFocusFactorRequest): void => {
      if (sprint === null) return;
      const sprintId = sprint.id;
      setOverriding(true);
      void client
        .overrideFocusFactor(sprintId, request)
        .then((updated) => {
          setSprint(updated);
          setShowOverride(false);
          setActionError(null);
        })
        .catch((err: unknown) => setActionError(err))
        .finally(() => setOverriding(false));
    },
    [sprint, client],
  );

  const openBoard = useCallback((): void => {
    if (config === null) return;
    // SPIKE: confirm host API — native board URL. Falls back to a same-origin path.
    window.open(`/agiles/${encodeURIComponent(config.boardId)}`, '_blank', 'noopener');
  }, [config]);

  if (status === 'loading') return <LoadingState message="Loading Sprint capacity…" />;
  if (status === 'error') return <ErrorState error={loadError} onRetry={() => void load()} />;
  if (!configured) {
    return (
      <EmptyState
        title="Not configured yet"
        description="An administrator needs to set up the Sprint Capacity Planner in project settings before this tab can be used."
      />
    );
  }

  const selectData = sprints.map((s) => ({
    key: s.id,
    label: `${s.name}${s.archived ? ' (archived)' : ''}`,
    id: s.id,
  }));
  const selectedItem = selectData.find((item) => item.key === selectedId) ?? null;

  return (
    <div style={{ padding: 'calc(var(--ring-unit) * 2)', font: 'var(--ring-font)' }}>
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
        <Select
          data={selectData}
          selected={selectedItem}
          label="Select a Sprint"
          filter
          onSelect={(item) => {
            if (item !== null && typeof item.key === 'string') selectSprint(item.key);
          }}
        />
        <div style={{ flex: 1 }} />
        {isManager ? (
          <Button primary onClick={() => setShowCreate(true)} disabled={sprint === null}>
            Create next Sprint
          </Button>
        ) : null}
        <Button onClick={openBoard} disabled={config === null}>
          Open board
        </Button>
        {isManager ? (
          <Button onClick={recalculate} loader={recalculating} disabled={sprint === null || recalculating}>
            Recalculate
          </Button>
        ) : null}
        <Button onClick={() => void load()}>Refresh</Button>
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
              sprint={sprint}
              editable={isManager}
              saving={savingDetails}
              onSave={saveDetails}
            />
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Capacity</h2>
            <CapacityTable
              rows={rows}
              hoursPerDay={hoursPerDay}
              isManager={isManager}
              currentUserId={currentUserId ?? ''}
              assignedEffort={sprint.assignedEffort}
              drafts={drafts}
              savingUserIds={savingUserIds}
              onAvailableInput={(userId, days) => updateDraft(userId, { availableDays: days })}
              onNoteInput={(userId, note) => updateDraft(userId, { note })}
              onConfirmedToggle={(userId, confirmed) => void patchCapacity(userId, { confirmed })}
              onCommit={commitRow}
            />
          </section>

          <section style={sectionStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 'calc(var(--ring-unit) * 1.5)',
              }}
            >
              <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Capacity summary</h2>
              {isManager ? (
                <Button inline onClick={() => setShowOverride(true)}>
                  Override focus factor
                </Button>
              ) : null}
            </div>
            <CapacitySummary sprint={sprint} hoursPerDay={hoursPerDay} />
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Effort</h2>
            <EffortSummary sprint={sprint} hoursPerDay={hoursPerDay} />
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Data health</h2>
            <DataHealth sprint={sprint} />
          </section>
        </>
      )}

      {sprint !== null && config !== null ? (
        <CreateNextSprintDialog
          show={showCreate}
          preview={computePreview(config, latestManagedSprint)}
          creating={creating}
          onCancel={() => setShowCreate(false)}
          onCreate={createNextSprint}
        />
      ) : null}

      {sprint !== null && config !== null ? (
        <FocusFactorOverrideDialog
          show={showOverride}
          currentValue={sprint.focusFactor}
          minFocusFactor={config.minFocusFactor}
          maxFocusFactor={config.maxFocusFactor}
          saving={overriding}
          onCancel={() => setShowOverride(false)}
          onSubmit={overrideFocusFactor}
        />
      ) : null}
    </div>
  );
}
