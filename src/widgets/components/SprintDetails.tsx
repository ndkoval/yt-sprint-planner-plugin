import React, { useState } from 'react';
import Input, { Size as InputSize } from '@jetbrains/ring-ui-built/components/input/input';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import type { PatchSprintDetailsRequest, SprintView } from '../../shared/api';

export interface SprintDetailsProps {
  sprint: SprintView;
  editable: boolean;
  saving?: boolean;
  onSave(patch: PatchSprintDetailsRequest): void;
}

interface Draft {
  name: string;
  goal: string;
  start: string;
  finish: string;
}

function draftFromSprint(sprint: SprintView): Draft {
  return { name: sprint.name, goal: sprint.goal, start: sprint.start, finish: sprint.finish };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (draft.name.trim().length === 0) errors.name = 'Name is required.';
  if (!ISO_DATE.test(draft.start)) errors.start = 'Enter a valid date.';
  if (!ISO_DATE.test(draft.finish)) errors.finish = 'Enter a valid date.';
  if (ISO_DATE.test(draft.start) && ISO_DATE.test(draft.finish) && draft.finish < draft.start) {
    errors.finish = 'Finish must be on or after start.';
  }
  return errors;
}

const fieldStyle: React.CSSProperties = { marginBottom: 'calc(var(--ring-unit) * 2)' };

/**
 * §6.3 Sprint details editor: name/goal/start/finish with validation. Changing a date
 * reveals a "Reset to default" affordance restoring the persisted schedule.
 */
export function SprintDetails({
  sprint,
  editable,
  saving = false,
  onSave,
}: SprintDetailsProps): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftFromSprint(sprint));
  const errors = validate(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const original = draftFromSprint(sprint);
  const datesChanged = draft.start !== original.start || draft.finish !== original.finish;
  const dirty =
    draft.name !== original.name || draft.goal !== original.goal || datesChanged;

  if (!editable) {
    return (
      <dl style={{ margin: 0 }}>
        <dt style={{ color: 'var(--ring-secondary-color)', font: 'var(--ring-font-smaller)' }}>
          Goal
        </dt>
        <dd style={{ margin: '0 0 var(--ring-unit)' }}>{sprint.goal || '—'}</dd>
        <dt style={{ color: 'var(--ring-secondary-color)', font: 'var(--ring-font-smaller)' }}>
          Schedule
        </dt>
        <dd style={{ margin: 0 }}>
          {sprint.start} → {sprint.finish}
        </dd>
      </dl>
    );
  }

  const update = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  const handleSave = (): void => {
    if (hasErrors) return;
    const patch: PatchSprintDetailsRequest = {};
    if (draft.name !== original.name) patch.name = draft.name.trim();
    if (draft.goal !== original.goal) patch.goal = draft.goal;
    if (draft.start !== original.start) patch.start = draft.start;
    if (draft.finish !== original.finish) patch.finish = draft.finish;
    onSave(patch);
  };

  return (
    <form
      aria-label="Sprint details"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        handleSave();
      }}
    >
      <div style={fieldStyle}>
        <Input
          label="Name"
          size={InputSize.L}
          value={draft.name}
          error={errors.name ?? null}
          disabled={saving}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ name: e.target.value })}
        />
      </div>
      <div style={fieldStyle}>
        <Input
          label="Goal"
          multiline
          size={InputSize.L}
          value={draft.goal}
          disabled={saving}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update({ goal: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 'calc(var(--ring-unit) * 2)', ...fieldStyle }}>
        <Input
          label="Start"
          type="date"
          value={draft.start}
          error={errors.start ?? null}
          disabled={saving}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ start: e.target.value })}
        />
        <Input
          label="Finish"
          type="date"
          value={draft.finish}
          error={errors.finish ?? null}
          disabled={saving}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ finish: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--ring-unit)', alignItems: 'center' }}>
        <Button primary type="submit" loader={saving} disabled={saving || hasErrors || !dirty}>
          Save details
        </Button>
        {datesChanged ? (
          <Button
            disabled={saving}
            onClick={() => update({ start: original.start, finish: original.finish })}
          >
            Reset to default dates
          </Button>
        ) : null}
      </div>
    </form>
  );
}
