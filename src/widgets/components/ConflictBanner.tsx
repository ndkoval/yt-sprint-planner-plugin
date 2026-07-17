import React from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';

export interface ConflictBannerProps {
  /** Human-readable summary of what changed under the user. */
  message?: string;
  onRetry: () => void;
  onDismiss: () => void;
  retrying?: boolean;
}

/**
 * Shown after a 409 optimistic-concurrency conflict. The caller has already reloaded
 * the latest data and preserved the user's typed value; this banner offers a retry
 * without overwriting anyone else's rows.
 */
export function ConflictBanner({
  message = 'Someone else updated this Sprint while you were editing. We reloaded the latest values and kept your changes.',
  onRetry,
  onDismiss,
  retrying = false,
}: ConflictBannerProps): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--ring-unit) * 2)',
        padding: 'calc(var(--ring-unit) * 1.5) calc(var(--ring-unit) * 2)',
        marginBottom: 'calc(var(--ring-unit) * 2)',
        borderRadius: 'var(--ring-border-radius)',
        background: 'var(--ring-warning-background-color, #fff6e0)',
        border: '1px solid var(--ring-warning-color, #e0b400)',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <Button primary onClick={onRetry} loader={retrying} disabled={retrying}>
        Retry my change
      </Button>
      <Button onClick={onDismiss} disabled={retrying}>
        Dismiss
      </Button>
    </div>
  );
}
