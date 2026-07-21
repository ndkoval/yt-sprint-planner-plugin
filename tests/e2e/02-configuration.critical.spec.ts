/**
 * Settings round-trip on a real instance: the manager edits a value, saves, and the
 * change persists across a full reload. Also pins the settings form's key controls
 * (board picker, effort-field pickers, reminder override) against the live widget.
 */
import { PROJECTS, openSettings } from './fixtures/app';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('configuration', () => {
  test('settings form shows the seeded configuration controls', async ({ managerPage }) => {
    const frame = await openSettings(managerPage, PROJECTS.two.key);
    // Board is preselected with the project's own board (Ring Select = combobox named
    // by its label, showing the selected value as text).
    await expect(frame.getByRole('combobox', { name: 'Select a board' })).toContainText(
      'Capacity Two Board',
    );
    // Effort-field pickers carry the configured period fields (Original first).
    const fieldPickers = frame.getByRole('combobox', { name: 'Select a field' });
    await expect(fieldPickers.nth(0)).toContainText('Original Effort');
    await expect(fieldPickers.nth(1)).toContainText('Current Effort');
    // The per-project reminder override exists, empty by default (app default applies).
    await expect(frame.getByLabel(/Availability reminder lead/i)).toHaveValue('');
  });

  test('sprint length edit persists across reloads', async ({ managerPage }) => {
    const frame = await openSettings(managerPage, PROJECTS.two.key);
    await frame.getByLabel(/Sprint length/i).fill('10');
    await frame.getByRole('button', { name: 'Save settings' }).click();
    await expect(frame.getByText('Settings saved.')).toBeVisible();

    const again = await openSettings(managerPage, PROJECTS.two.key);
    await expect(again.getByLabel(/Sprint length/i)).toHaveValue('10');
  });

  test('per-project reminder lead persists, 0 allowed (= disabled)', async ({ managerPage }) => {
    const frame = await openSettings(managerPage, PROJECTS.two.key);
    await frame.getByLabel(/Availability reminder lead/i).fill('0');
    await frame.getByRole('button', { name: 'Save settings' }).click();
    await expect(frame.getByText('Settings saved.')).toBeVisible();

    const again = await openSettings(managerPage, PROJECTS.two.key);
    await expect(again.getByLabel(/Availability reminder lead/i)).toHaveValue('0');
  });

  test('invalid input blocks saving with a visible message', async ({ managerPage }) => {
    const frame = await openSettings(managerPage, PROJECTS.two.key);
    await frame.getByLabel(/Sprint length/i).fill('0');
    await expect(frame.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await expect(frame.getByText(/issue(s)? to resolve before saving/)).toBeVisible();
    // Restore a valid value so later specs see a sane config.
    await frame.getByLabel(/Sprint length/i).fill('10');
    await expect(frame.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  });
});
