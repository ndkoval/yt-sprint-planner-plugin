import React, { useState } from 'react';
import Dialog from '@jetbrains/ring-ui-built/components/dialog/dialog';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import { formatPercent } from './format';

export interface FocusFactorOverrideDialogProps {
  show: boolean;
  currentValue: number;
  saving?: boolean;
  onCancel(): void;
  onSubmit(request: { newValue: number; reason: string }): void;
}

/**
 * Manager-only dialog to manually override a Sprint's Focus Factor (§ focus factor).
 * A factor is a fraction of capacity, so any value in 0–100% is allowed.
 */
export function FocusFactorOverrideDialog({
  show,
  currentValue,
  saving = false,
  onCancel,
  onSubmit,
}: FocusFactorOverrideDialogProps): React.JSX.Element {
  const [percentText, setPercentText] = useState(String(Math.round(currentValue * 100)));
  const [reason, setReason] = useState('');

  const percent = Number(percentText);
  const value = percent / 100;
  const outOfRange = !Number.isFinite(percent) || value < 0 || value > 1;
  const reasonMissing = reason.trim().length === 0;
  const rangeError = outOfRange ? 'Enter a value between 0% and 100%.' : null;

  const handleSubmit = (): void => {
    if (outOfRange || reasonMissing) return;
    onSubmit({ newValue: value, reason: reason.trim() });
  };

  return (
    <Dialog
      show={show}
      label="Override focus factor"
      trapFocus
      autoFocusFirst
      showCloseButton
      onCloseAttempt={() => {
        if (!saving) onCancel();
      }}
    >
      <div style={{ padding: 'calc(var(--ring-unit) * 3)', minWidth: 380 }}>
        <h2 style={{ marginTop: 0, font: 'var(--ring-font-larger)' }}>Override focus factor</h2>
        <p style={{ color: 'var(--ring-secondary-color)' }}>
          Current: {formatPercent(currentValue)}
        </p>
        <div style={{ marginBottom: 'calc(var(--ring-unit) * 2)' }}>
          <Input
            label="New focus factor (%)"
            type="number"
            min={0}
            max={100}
            size={InputSize.M}
            value={percentText}
            error={rangeError}
            disabled={saving}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPercentText(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 'calc(var(--ring-unit) * 2)' }}>
          <Input
            label="Reason"
            multiline
            size={InputSize.FULL}
            value={reason}
            error={reasonMissing ? 'A reason is required.' : null}
            disabled={saving}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ring-unit)' }}>
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            primary
            onClick={handleSubmit}
            loader={saving}
            disabled={saving || outOfRange || reasonMissing}
          >
            Apply override
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
