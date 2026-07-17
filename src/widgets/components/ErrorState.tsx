import React from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import { ApiClientError } from '../api-client';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
}

function describe(error: unknown): { message: string; correlationId?: string } {
  if (error instanceof ApiClientError) {
    return { message: error.message, correlationId: error.correlationId };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Something went wrong.' };
}

/** Error panel with an optional retry action. Used for failed top-level loads. */
export function ErrorState({ error, onRetry }: ErrorStateProps): React.JSX.Element {
  const { message, correlationId } = describe(error);
  return (
    <div
      role="alert"
      style={{
        padding: 'calc(var(--ring-unit) * 2)',
        border: '1px solid var(--ring-error-color)',
        borderRadius: 'var(--ring-border-radius)',
        color: 'var(--ring-error-color)',
        background: 'var(--ring-error-background-color, transparent)',
      }}
    >
      <div style={{ fontWeight: 'bold' }}>Unable to load</div>
      <p style={{ marginTop: 'var(--ring-unit)' }}>{message}</p>
      {correlationId !== undefined && correlationId.length > 0 ? (
        <p style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
          Reference: {correlationId}
        </p>
      ) : null}
      {onRetry !== undefined ? (
        <div style={{ marginTop: 'calc(var(--ring-unit) * 2)' }}>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      ) : null}
    </div>
  );
}
