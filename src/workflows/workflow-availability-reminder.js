/**
 * workflow-availability-reminder.js — Issue.onSchedule rule (availability nudges).
 *
 * Once a day, for each upcoming managed Sprint whose start is within the reminder
 * lead window, notify every participant who has not confirmed their availability yet
 * (their capacity row is still the untouched default). Reminders are informational
 * and never block.
 *
 * Lead window: since config v4 `reminderLeadDays` is a TEAM setting (0 = reminders
 * DISABLED for the team) and wins over the app-level setting; v2/v3 documents carry
 * a project-level override instead. Both default to 3 days.
 *
 * This is the app's only workflow rule. Sprint metrics are computed live by the
 * backend/widget on every read, so no on-change bookkeeping rules are needed.
 *
 * VERSION TOLERANCE: this rule reads the raw extension properties and must accept
 * v2 (one flat capacity per sprint), v3 (per-team capacity inside shared sprint
 * entries) AND v4 (per-team sprint maps) documents — documents migrate lazily on
 * the backend's next write, so a project nobody edits after an upgrade keeps its
 * old JSON indefinitely.
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

/** An integer lead-days value (0 = disabled), or null when absent/invalid. */
const leadDaysOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
};

/**
 * All capacity-row maps of one sprint entry, tolerating every schema era:
 * v4 keeps ONE capacity document at the entry's top level (the entry itself is
 * per-team); v3 kept one per team under `entry.teams`; v2 kept a single flat
 * `entry.capacity`.
 */
const capacityRowMaps = (entry) => {
  const maps = [];
  if (entry.teams && typeof entry.teams === 'object') {
    Object.keys(entry.teams).forEach((teamId) => {
      const team = entry.teams[teamId];
      if (team && team.capacity && team.capacity.rows) maps.push(team.capacity.rows);
    });
  } else if (entry.capacity && entry.capacity.rows) {
    maps.push(entry.capacity.rows);
  }
  return maps;
};

/**
 * Flatten a sprint-data document of ANY supported era into reminder units:
 * `{ key, entry, rowMaps, leadDays }`. v4 units are per team (key `teamId/sprintId`,
 * lead from the team's own config); v2/v3 units are per sprint (plain sprintId key,
 * lead from the project-level override).
 */
const reminderUnits = (data, config, appLeadDays) => {
  const units = [];
  if (data.version === 4 && data.teams && typeof data.teams === 'object') {
    const cfgTeams = {};
    const cfgList =
      config && config.config && Array.isArray(config.config.teams) ? config.config.teams : [];
    cfgList.forEach((t) => {
      if (t && typeof t.id === 'string') cfgTeams[t.id] = t;
    });
    Object.keys(data.teams).forEach((teamId) => {
      const teamCfg = cfgTeams[teamId];
      // Teams REMOVED from the config are retained in storage but never reminded.
      if (!teamCfg) return;
      const teamLead = leadDaysOf(teamCfg.reminderLeadDays);
      const leadDays = teamLead !== null ? teamLead : appLeadDays;
      const sprints = (data.teams[teamId] && data.teams[teamId].sprints) || {};
      Object.keys(sprints).forEach((sprintId) => {
        units.push({
          key: teamId + '/' + sprintId,
          entry: sprints[sprintId],
          rowMaps: capacityRowMaps(sprints[sprintId]),
          leadDays,
        });
      });
    });
    return units;
  }
  if ((data.version === 2 || data.version === 3) && data.sprints) {
    const projectLead =
      config && config.config ? leadDaysOf(config.config.reminderLeadDays) : null;
    const leadDays = projectLead !== null ? projectLead : appLeadDays;
    Object.keys(data.sprints).forEach((sprintId) => {
      units.push({
        key: sprintId,
        entry: data.sprints[sprintId],
        rowMaps: capacityRowMaps(data.sprints[sprintId]),
        leadDays,
      });
    });
  }
  return units;
};

/** Send reminders for every upcoming Sprint of one project. Returns quietly on error. */
const remindForProject = (project, appLeadDays, nowMs) => {
  const props = project.extensionProperties;
  const data = parseJson(props.scpSprintDataJson);
  if (!data) return;
  const config = parseJson(props.scpConfigJson);
  const units = reminderUnits(data, config, appLeadDays);
  if (units.length === 0) return;

  const state = parseJson(props.scpReminderStateJson) || { version: 1, remindedOn: {} };
  const today = isoDay(nowMs);
  let stateChanged = false;
  const entryByKey = {};

  units.forEach((unit) => {
    const entry = unit.entry;
    if (!entry || typeof entry.start !== 'string') return;
    entryByKey[unit.key] = entry;
    if (unit.leadDays === 0) return; // reminders disabled for this team/project
    const startMs = dayToMs(entry.start);
    const upcoming = startMs >= nowMs && startMs <= nowMs + unit.leadDays * MS_PER_DAY;
    if (!upcoming || state.remindedOn[unit.key] === today) return;

    unit.rowMaps.forEach((rows) => {
      Object.keys(rows).forEach((login) => {
        const row = rows[login];
        if (!row || row.availableWasCustomized === true) return;
        const user = entities.User.findByLogin(login);
        if (!user) return;
        user.notify(
          'Set your availability for ' + (entry.name || 'the upcoming sprint'),
          'You have not set your availability for "' +
            (entry.name || unit.key) +
            '" yet — it is still the default. Please review and adjust it if needed. ' +
            'This is an informational reminder.',
        );
      });
    });

    state.remindedOn[unit.key] = today;
    stateChanged = true;
  });

  // Drop stamps for sprints that no longer exist or have started (any key era).
  Object.keys(state.remindedOn).forEach((key) => {
    const entry = entryByKey[key];
    if (!entry || dayToMs(entry.start) < nowMs) {
      delete state.remindedOn[key];
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
      const appLead = leadDaysOf(ctx.settings && ctx.settings.reminderLeadDays);
      remindForProject(ctx.issue.project, appLead !== null ? appLead : DEFAULT_LEAD_DAYS, nowMs);
    } catch (e) {
      // Reminders never block or escalate.
      console.error('scp: availability reminder failed: ' + String(e && e.message ? e.message : e));
    }
  },
  requirements: {},
});

// Exported for unit tests (loaded with a stubbed scripting API).
exports._internals = { remindForProject, reminderUnits, capacityRowMaps, leadDaysOf };
