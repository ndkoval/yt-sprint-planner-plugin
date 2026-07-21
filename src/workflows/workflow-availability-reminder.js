/**
 * workflow-availability-reminder.js — Issue.onSchedule rule (availability nudges).
 *
 * Once a day, for each upcoming managed Sprint whose start is within the reminder
 * lead window (app setting `reminderLeadDays`, default 3 days), notify every
 * participant who has not confirmed their availability yet (their capacity row is
 * still the untouched default). Reminders are informational and never block.
 *
 * This is the app's only workflow rule. Sprint metrics are computed live by the
 * backend/widget on every read, so no on-change bookkeeping rules are needed.
 *
 * SHAPE (follows the production-workflow conventions):
 *   - Daily cron at a staggered off-peak minute; scheduled rules never run more often.
 *   - muteUpdateNotifications: the rule's own writes must not spam watchers.
 *   - Self-limiting: the FIRST matching issue of a project performs the whole
 *     project's reminder pass and stamps `scpReminderStateJson`; every other issue
 *     that day short-circuits on the stamp. All app state is project-scoped
 *     (issue.project.extensionProperties), so one issue is enough to reach it.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

const entities = require('@jetbrains/youtrack-scripting-api/entities');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LEAD_DAYS = 3;

/** yyyy-mm-dd for a UTC timestamp. */
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** UTC-midnight ms for a yyyy-mm-dd date. */
const dayToMs = (iso) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

const parseJson = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Send reminders for every upcoming Sprint of one project. Returns quietly on error. */
const remindForProject = (project, leadDays, nowMs) => {
  const props = project.extensionProperties;
  const data = parseJson(props.scpSprintDataJson);
  if (!data || data.version !== 2 || !data.sprints) return;

  const state = parseJson(props.scpReminderStateJson) || { version: 1, remindedOn: {} };
  const today = isoDay(nowMs);
  let stateChanged = false;

  Object.keys(data.sprints).forEach((sprintId) => {
    const entry = data.sprints[sprintId];
    if (!entry || typeof entry.start !== 'string') return;
    const startMs = dayToMs(entry.start);
    const upcoming = startMs >= nowMs && startMs <= nowMs + leadDays * MS_PER_DAY;
    if (!upcoming || state.remindedOn[sprintId] === today) return;

    const rows = (entry.capacity && entry.capacity.rows) || {};
    Object.keys(rows).forEach((login) => {
      const row = rows[login];
      if (!row || row.availableWasCustomized === true) return;
      const user = entities.User.findByLogin(login);
      if (!user) return;
      user.notify(
        'Set your availability for ' + (entry.name || 'the upcoming sprint'),
        'You have not set your availability for "' +
          (entry.name || sprintId) +
          '" yet — it is still the default. Please review and adjust it if needed. ' +
          'This is an informational reminder.',
      );
    });

    state.remindedOn[sprintId] = today;
    stateChanged = true;
  });

  // Drop stamps for sprints that no longer exist or have started.
  Object.keys(state.remindedOn).forEach((sprintId) => {
    const entry = data.sprints[sprintId];
    if (!entry || dayToMs(entry.start) < nowMs) {
      delete state.remindedOn[sprintId];
      stateChanged = true;
    }
  });

  if (stateChanged) props.scpReminderStateJson = JSON.stringify(state);
};

exports.rule = entities.Issue.onSchedule({
  title: 'Sprint Capacity Planner: remind participants to confirm availability',
  // Daily at a staggered off-peak minute (Quartz 6-field cron).
  cron: '0 47 7 * * ?',
  // The rule only runs in projects the app is attached to; the per-day stamp in
  // scpReminderStateJson makes the pass self-limiting (one issue does the work,
  // the rest short-circuit), so no issue-level guard is needed.
  search: '#Unresolved',
  muteUpdateNotifications: true,
  action: (ctx) => {
    try {
      const nowMs = Date.now();
      const configured = Number(ctx.settings && ctx.settings.reminderLeadDays);
      const leadDays = configured > 0 ? configured : DEFAULT_LEAD_DAYS;
      remindForProject(ctx.issue.project, leadDays, nowMs);
    } catch (e) {
      // Reminders never block or escalate.
      console.error('scp: availability reminder failed: ' + String(e && e.message ? e.message : e));
    }
  },
  requirements: {},
});
