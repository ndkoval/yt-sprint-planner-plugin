import React, { useState } from 'react';
import Dialog from '@jetbrains/ring-ui-built/components/dialog/dialog';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import Checkbox from '@jetbrains/ring-ui-built/components/checkbox/checkbox';
import type { CreateNextSprintRequest } from '../../shared/api';

/** Read-only preview of the next Sprint the backend would create. */
export interface NextSprintPreview {
  name: string;
  start: string;
  finish: string;
}

export interface CreateNextSprintDialogProps {
  show: boolean;
  /** Computed preview of the next Sprint; omitted while loading. */
  preview?: NextSprintPreview;
  creating?: boolean;
  onCancel(): void;
  onCreate(request: CreateNextSprintRequest): void;
}

const rowStyle: React.CSSProperties = { marginBottom: 'calc(var(--ring-unit) * 2)' };

/** §14.1 Create-next-Sprint dialog. "Move unresolved issues" defaults to false. */
export function CreateNextSprintDialog({
  show,
  preview,
  creating = false,
  onCancel,
  onCreate,
}: CreateNextSprintDialogProps): React.JSX.Element {
  const [goal, setGoal] = useState('');
  const [moveUnresolvedIssues, setMoveUnresolvedIssues] = useState(false);

  const handleCreate = (): void => {
    const request: CreateNextSprintRequest = { moveUnresolvedIssues };
    if (goal.trim().length > 0) request.goal = goal.trim();
    onCreate(request);
  };

  return (
    <Dialog
      show={show}
      label="Create next Sprint"
      trapFocus
      autoFocusFirst
      showCloseButton
      onCloseAttempt={() => {
        if (!creating) onCancel();
      }}
    >
      <div style={{ padding: 'calc(var(--ring-unit) * 3)', minWidth: 420 }}>
        <h2 style={{ marginTop: 0, font: 'var(--ring-font-larger)' }}>Create next Sprint</h2>

        <div
          style={{
            ...rowStyle,
            padding: 'calc(var(--ring-unit) * 1.5)',
            background: 'var(--ring-selected-background-color, #eef1f5)',
            borderRadius: 'var(--ring-border-radius)',
          }}
        >
          {preview ? (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
              <dt style={{ color: 'var(--ring-secondary-color)' }}>Name</dt>
              <dd style={{ margin: 0 }}>{preview.name}</dd>
              <dt style={{ color: 'var(--ring-secondary-color)' }}>Start</dt>
              <dd style={{ margin: 0 }}>{preview.start}</dd>
              <dt style={{ color: 'var(--ring-secondary-color)' }}>Finish</dt>
              <dd style={{ margin: 0 }}>{preview.finish}</dd>
            </dl>
          ) : (
            <span style={{ color: 'var(--ring-secondary-color)' }}>Computing preview…</span>
          )}
        </div>

        <div style={rowStyle}>
          <Input
            label="Goal (optional)"
            multiline
            size={InputSize.FULL}
            value={goal}
            disabled={creating}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGoal(e.target.value)}
          />
        </div>

        <div style={rowStyle}>
          <Checkbox
            label="Move unresolved issues from the current Sprint"
            checked={moveUnresolvedIssues}
            disabled={creating}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setMoveUnresolvedIssues(e.target.checked)
            }
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ring-unit)' }}>
          <Button onClick={onCancel} disabled={creating}>
            Cancel
          </Button>
          <Button primary onClick={handleCreate} loader={creating} disabled={creating || !preview}>
            Create Sprint
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
