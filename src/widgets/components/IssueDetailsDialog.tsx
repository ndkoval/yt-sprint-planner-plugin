import React, { useState } from 'react';
import Dialog from '@jetbrains/ring-ui-built/components/dialog/dialog';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import type { IssueView } from '../../shared/api';
import { daysToMinutes, minutesToDays } from '../../shared/units';

export interface AssigneeOption {
  userId: string;
  name: string;
}

export interface IssueDetailsDialogProps {
  issue: IssueView;
  hoursPerDay: number;
  originalEffortLabel: string;
  currentEffortLabel: string;
  /** Teammates in the Sprint, for the assignee dropdown. */
  assigneeOptions: AssigneeOption[];
  isManager: boolean;
  saving?: boolean;
  error?: string | null;
  onSave(patch: {
    originalEffortMinutes?: number | null;
    currentEffortMinutes?: number | null;
    assigneeId?: string | null;
  }): void;
  onClose(): void;
}

function daysText(minutes: number | null, hoursPerDay: number): string {
  if (minutes === null) return '';
  return String(Math.round(minutesToDays(minutes, hoursPerDay) * 100) / 100);
}

/**
 * In-page issue dialog for the planner. Double-clicking a card opens THIS (a Ring UI modal that
 * stays on the planning page — never a new tab/window), so a manager can see the issue's details
 * and adjust its Original/Current Effort and assignee instantly, then save without leaving the
 * plan. Editing is manager-only and enforced again server-side (PATCH …/issues/:id).
 */
export function IssueDetailsDialog({
  issue,
  hoursPerDay,
  originalEffortLabel,
  currentEffortLabel,
  assigneeOptions,
  isManager,
  saving = false,
  error = null,
  onSave,
  onClose,
}: IssueDetailsDialogProps): React.JSX.Element {
  const [origText, setOrigText] = useState(daysText(issue.originalEffortMinutes, hoursPerDay));
  const [curText, setCurText] = useState(daysText(issue.currentEffortMinutes, hoursPerDay));
  const [assigneeId, setAssigneeId] = useState<string>(issue.assigneeId ?? '');

  // '' → cleared (null); a valid non-negative number → minutes; undefined → invalid input.
  const parseDays = (text: string): number | null | undefined => {
    const t = text.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(daysToMinutes(n, hoursPerDay));
  };

  const origMin = parseDays(origText);
  const curMin = parseDays(curText);
  const invalid = origMin === undefined || curMin === undefined;

  const handleSave = (): void => {
    if (invalid || !isManager) return;
    const patch: {
      originalEffortMinutes?: number | null;
      currentEffortMinutes?: number | null;
      assigneeId?: string | null;
    } = {};
    const newOrig = origMin ?? null;
    if (newOrig !== issue.originalEffortMinutes) patch.originalEffortMinutes = newOrig;
    const newCur = curMin ?? null;
    if (newCur !== issue.currentEffortMinutes) patch.currentEffortMinutes = newCur;
    const newAssignee = assigneeId === '' ? null : assigneeId;
    if (newAssignee !== (issue.assigneeId ?? null)) patch.assigneeId = newAssignee;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onSave(patch);
  };

  const unit = 'var(--ring-unit)';
  const labelStyle: React.CSSProperties = {
    display: 'block',
    font: 'var(--ring-font-smaller)',
    color: 'var(--ring-secondary-color)',
    marginBottom: `calc(${unit} / 2)`,
  };
  const fieldStyle: React.CSSProperties = { marginBottom: `calc(${unit} * 2)` };

  return (
    <Dialog
      show
      label={`Issue ${issue.idReadable}`}
      trapFocus
      autoFocusFirst
      showCloseButton
      onCloseAttempt={() => {
        if (!saving) onClose();
      }}
    >
      <div data-test="scp-issue-dialog" style={{ padding: `calc(${unit} * 3)`, minWidth: 440, maxWidth: 560 }}>
        <div style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
          {issue.idReadable}
          {issue.resolved ? ' · resolved' : ''}
        </div>
        <h2 style={{ marginTop: `calc(${unit} / 2)`, marginBottom: `calc(${unit} * 2)`, font: 'var(--ring-font-larger)' }}>
          {issue.summary}
        </h2>

        <div style={fieldStyle}>
          <Input
            label={`${originalEffortLabel} (days)`}
            type="number"
            min={0}
            step={0.25}
            size={InputSize.M}
            value={origText}
            disabled={!isManager || saving}
            error={origMin === undefined ? 'Enter a non-negative number of days (or clear it).' : null}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrigText(e.target.value)}
          />
        </div>

        <div style={fieldStyle}>
          <Input
            label={`${currentEffortLabel} (days)`}
            type="number"
            min={0}
            step={0.25}
            size={InputSize.M}
            value={curText}
            disabled={!isManager || saving}
            error={curMin === undefined ? 'Enter a non-negative number of days (or clear it).' : null}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurText(e.target.value)}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="scp-issue-assignee" style={labelStyle}>
            Assignee
          </label>
          <select
            id="scp-issue-assignee"
            value={assigneeId}
            disabled={!isManager || saving}
            onChange={(e) => setAssigneeId(e.target.value)}
            style={{
              width: '100%',
              height: `calc(${unit} * 4)`,
              padding: `0 ${unit}`,
              borderRadius: 'var(--ring-border-radius)',
              border: '1px solid var(--ring-borders-color)',
              background: 'var(--ring-input-background-color)',
              color: 'var(--ring-text-color)',
            }}
          >
            <option value="">Unassigned</option>
            {assigneeOptions.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        {error !== null && error !== '' ? (
          <div style={{ color: 'var(--ring-error-color)', marginBottom: `calc(${unit} * 2)` }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: unit }}>
          <Button onClick={onClose} disabled={saving}>
            {isManager ? 'Cancel' : 'Close'}
          </Button>
          {isManager ? (
            <Button primary onClick={handleSave} loader={saving} disabled={saving || invalid}>
              Save changes
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
