import React from 'react';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import type { AssigneeEffortView } from '../../shared/api';
import type { CapacityRow } from '../../shared/types';
import { formatDaysValue } from '../../shared/units';
import { formatTimestamp } from './format';

/** Editable draft values held by the parent so conflicts can preserve typed input. */
export interface RowDraft {
  availableDays: string;
  note: string;
}

export interface CapacityTableProps {
  rows: CapacityRow[];
  hoursPerDay: number;
  isManager: boolean;
  currentUserId: string;
  /** Per-assignee effort (keyed by user id) so each row shows its assigned load. */
  assignedEffort: Record<string, AssigneeEffortView>;
  /** Draft overrides keyed by userId; falls back to the persisted value when absent. */
  drafts: Record<string, RowDraft>;
  savingUserIds: ReadonlySet<string>;
  onAvailableInput(userId: string, days: string): void;
  onNoteInput(userId: string, note: string): void;
  /** Commit the current draft (available + note) for a row, e.g. on blur or Enter. */
  onCommit(userId: string): void;
}

const cellStyle: React.CSSProperties = {
  padding: 'calc(var(--ring-unit) * 1) calc(var(--ring-unit) * 1.5)',
  borderBottom: '1px solid var(--ring-line-color)',
  textAlign: 'left',
  verticalAlign: 'middle',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
  font: 'var(--ring-font-smaller)',
  color: 'var(--ring-secondary-color)',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
};

/**
 * §6.3 capacity table. Everyone is allocated at 100%, so there is no allocation column.
 * A participant may edit ONLY their own Available/Note; managers may edit every
 * row. Values are minutes in the model and rendered as plain day numbers (floats).
 */
export function CapacityTable({
  rows,
  hoursPerDay,
  isManager,
  currentUserId,
  assignedEffort,
  drafts,
  savingUserIds,
  onAvailableInput,
  onNoteInput,
  onCommit,
}: CapacityTableProps): React.JSX.Element {
  const canEdit = (row: CapacityRow): boolean => isManager || row.userId === currentUserId;

  return (
    <table
      style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--ring-font)' }}
      aria-label="Sprint capacity by participant"
    >
      <thead>
        <tr>
          <th style={headStyle} scope="col">
            Person
          </th>
          <th style={headStyle} scope="col">
            Default
          </th>
          <th style={headStyle} scope="col">
            Available
          </th>
          <th style={headStyle} scope="col">
            Assigned
          </th>
          <th style={headStyle} scope="col">
            Load (committed / capacity)
          </th>
          <th style={headStyle} scope="col">
            Note
          </th>
          <th style={headStyle} scope="col">
            Last updated
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const editable = canEdit(row);
          const saving = savingUserIds.has(row.userId);
          const draft = drafts[row.userId];
          const availableValue = draft?.availableDays ?? formatDaysValue(row.availableMinutes, hoursPerDay);
          const noteValue = draft?.note ?? row.note;
          const availableId = `available-${row.userId}`;
          const noteId = `note-${row.userId}`;
          return (
            <tr key={row.userId}>
              <td style={cellStyle}>{row.displayNameSnapshot || row.loginSnapshot}</td>
              <td style={cellStyle}>{formatDaysValue(row.defaultMinutes, hoursPerDay)}</td>
              <td style={cellStyle}>
                {editable ? (
                  <Input
                    id={availableId}
                    aria-label={`Available capacity in days for ${row.displayNameSnapshot}`}
                    size={InputSize.S}
                    type="number"
                    min={0}
                    step={0.25}
                    value={availableValue}
                    disabled={saving}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onAvailableInput(row.userId, e.target.value)
                    }
                    onBlur={() => onCommit(row.userId)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') onCommit(row.userId);
                    }}
                  />
                ) : (
                  formatDaysValue(row.availableMinutes, hoursPerDay)
                )}
              </td>
              <td style={cellStyle}>
                {formatDaysValue(assignedEffort[row.userId]?.currentEffortMinutes ?? 0, hoursPerDay)}
              </td>
              <td style={cellStyle}>
                {(() => {
                  // Committed = Original Effort of this person's assigned issues (Jira's
                  // per-person commitment); compared to their available capacity.
                  const committed = assignedEffort[row.userId]?.originalEffortMinutes ?? 0;
                  const capacity = row.availableMinutes;
                  const ratio = capacity > 0 ? committed / capacity : committed > 0 ? Infinity : 0;
                  const over = committed > capacity;
                  const pct = Math.min(100, Math.round(ratio * 100));
                  const barColor = over ? 'var(--ring-error-color, #c0341d)' : 'var(--ring-success-color, #1a936f)';
                  return (
                    <div
                      title={`${formatDaysValue(committed, hoursPerDay)}d committed of ${formatDaysValue(capacity, hoursPerDay)}d available`}
                    >
                      <div
                        style={{
                          width: 96,
                          height: 8,
                          borderRadius: 4,
                          background: 'var(--ring-line-color, #e0e0e0)',
                          overflow: 'hidden',
                        }}
                        role="img"
                        aria-label={`Load for ${row.displayNameSnapshot}: ${formatDaysValue(committed, hoursPerDay)} of ${formatDaysValue(capacity, hoursPerDay)} days`}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor }} />
                      </div>
                      <span
                        style={{
                          font: 'var(--ring-font-smaller)',
                          color: over ? 'var(--ring-error-color, #c0341d)' : 'var(--ring-secondary-color)',
                        }}
                      >
                        {formatDaysValue(committed, hoursPerDay)}/{formatDaysValue(capacity, hoursPerDay)}
                        {over ? ' ⚠ over' : ''}
                      </span>
                    </div>
                  );
                })()}
              </td>
              <td style={cellStyle}>
                {editable ? (
                  <Input
                    id={noteId}
                    aria-label={`Note for ${row.displayNameSnapshot}`}
                    size={InputSize.M}
                    value={noteValue}
                    disabled={saving}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onNoteInput(row.userId, e.target.value)
                    }
                    onBlur={() => onCommit(row.userId)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') onCommit(row.userId);
                    }}
                  />
                ) : (
                  row.note || '—'
                )}
              </td>
              <td style={cellStyle}>{formatTimestamp(row.updatedAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
