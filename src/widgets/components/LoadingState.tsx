import React from 'react';
import Loader from '@jetbrains/ring-ui-built/components/loader/loader';

export interface LoadingStateProps {
  message?: string;
}

/** Full-width loader used while a widget fetches its initial data. */
export function LoadingState({ message = 'Loading…' }: LoadingStateProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', justifyContent: 'center', padding: 'calc(var(--ring-unit) * 4)' }}
    >
      <Loader message={message} />
    </div>
  );
}
