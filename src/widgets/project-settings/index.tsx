import React from 'react';
import { createRoot } from 'react-dom/client';
import '@jetbrains/ring-ui-built/components/style.css';
import { SettingsForm } from './SettingsForm';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root not found in the widget host page.');
}
createRoot(container).render(
  <React.StrictMode>
    <SettingsForm />
  </React.StrictMode>,
);
