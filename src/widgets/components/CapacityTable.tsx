import React from 'react';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import Checkbox from '@jetbrains/ring-ui-built/components/checkbox/checkbox';
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
  /** Draft overrides keyed by userId; falls back to the persisted value when absent. */
  drafts: Record<string, RowDraft>;
  savingUserIds: ReadonlySet<string>;
  onAvailableInput(userId: string, days: string): void;
  onNoteInput(userId: string, note: string): void;
  onConfirmedToggle(userId: string, confirmed: boolean): void;
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
 * A participant may edit ONLY their own Available/Confirmed/Note; managers may edit every
 * row. Values are minutes in the model and rendered as plain day numbers (floats).
 */
export function CapacityTable({
  rows,
  hoursPerDay,
  isManager,
  currentUserId,
  drafts,
  savingUserIds,
  onAvailableInput,
  onNoteInput,
  onConfirmedToggle,
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
            Confirmed
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
          const confirmedId = `confirmed-${row.userId}`;
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
                <Checkbox
                  id={confirmedId}
                  aria-label={`Confirmed by ${row.displayNameSnapshot}`}
                  checked={row.confirmed}
                  disabled={!editable || saving}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onConfirmedToggle(row.userId, e.target.checked)
                  }
                />
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
