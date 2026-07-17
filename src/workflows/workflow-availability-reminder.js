/**
 * workflow-availability-reminder.js — Issue.onSchedule rule (availability nudges).
 *
 * TRIGGER: Cron (daily by default). For each upcoming managed Sprint whose start is
 * within the reminder lead window (app setting `reminderLeadDays`, default 3 days),
 * notify every participant whose capacity row has confirmed === false, asking them to
 * confirm their availability.
 *
 * WHY on an ISSUE schedule: onSchedule iterates ISSUES, so we reach Sprints through
 * their member issues and de-duplicate Sprints per run.
 *
 * ALGORITHM (per matching issue):
 *   1. For each managed Sprint the issue belongs to that has NOT been processed this
 *      run and starts within [now, now + leadDays]:
 *        a. Parse its capacity document (scpCapacityJson).
 *        b. For each row with confirmed === false, notify the user UNLESS they were
 *           already reminded within the last 24h (per-row `scpLastReminderAt`, an
 *           unknown field preserved inside the capacity document).
 *        c. Stamp scpLastReminderAt on reminded rows and persist the capacity doc.
 *
 * IDEMPOTENCE / RATE LIMIT: A person is never reminded more than once per 24h,
 * tracked by scpLastReminderAt inside their capacity row. Reminders are purely
 * INFORMATIONAL and must NEVER block anything.
 *
 * FAILURE POLICY: Swallow all errors (log only).
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

var MS_PER_DAY = 24 * 60 * 60 * 1000;
var DEFAULT_LEAD_DAYS = 3;

// SPIKE: verify on real YouTrack — module-level dedup state across a single run.
var remindedSprintsThisRun = {};

/**
 * True when the Sprint starts within the lead window [now, now + leadDays].
 */
function startsWithinLeadWindow(sprint, nowMs, leadDays) {
  var dates = common.getSprintDates(sprint);
  if (typeof dates.startMs !== 'number') return false;
  var windowEnd = nowMs + leadDays * MS_PER_DAY;
  return dates.startMs >= nowMs && dates.startMs <= windowEnd;
}

/**
 * Send reminders for one upcoming Sprint.
 * @param {object} sprint
 * @param {number} nowMs
 */
function remindForSprint(sprint, nowMs) {
  var doc = common.parseCapacityDocument(common.readExtProp(sprint, 'scpCapacityJson'));
  if (!doc || !doc.rows || typeof doc.rows !== 'object') return;

  var sprintName = common.readExtProp(sprint, 'name') || 'the upcoming sprint';
  var changed = false;

  var userIds = Object.keys(doc.rows);
  for (var i = 0; i < userIds.length; i++) {
    var row = doc.rows[userIds[i]];
    if (!row || row.confirmed === true) continue;

    // Rate limit: skip if reminded within the last 24h.
    var last = Number(row.scpLastReminderAt);
    if (isFinite(last) && last > 0 && nowMs - last < MS_PER_DAY) continue;

    var user = common.findUserById(row.userId || userIds[i]);
    var subject = 'Please confirm your availability for ' + sprintName;
    var body =
      'Your capacity for "' +
      sprintName +
      '" is not yet confirmed. Please review and confirm your availability. ' +
      'This is an informational reminder.';

    var sent = common.notifyUser(user, subject, body);
    // Record the attempt regardless of delivery success so we honour the 24h limit
    // even if the notification channel is temporarily unavailable.
    row.scpLastReminderAt = nowMs;
    changed = true;
    if (!sent) {
      console.warn('scp: reminder could not be delivered to ' + (row.userId || userIds[i]));
    }
  }

  if (changed) {
    // Persist the reminder timestamps, preserving unknown fields.
    common.writeExtProp(sprint, 'scpCapacityJson', common.serializeCapacityDocument(doc));
  }
}

/**
 * Process one issue's upcoming managed Sprints.
 * @param {object} issue
 */
function remindForIssue(issue) {
  var nowMs = Date.now();
  var leadDays = common.getAppSettingNumber('reminderLeadDays', DEFAULT_LEAD_DAYS);
  if (!(leadDays > 0)) leadDays = DEFAULT_LEAD_DAYS;

  var sprints = common.getManagedSprints(issue);
  for (var i = 0; i < sprints.length; i++) {
    var sprint = sprints[i];
    var id = common.sprintId(sprint);
    if (!id || remindedSprintsThisRun[id]) continue;
    if (!startsWithinLeadWindow(sprint, nowMs, leadDays)) continue;

    try {
      remindForSprint(sprint, nowMs);
      remindedSprintsThisRun[id] = true;
    } catch (e) {
      console.error('scp: reminder failed for sprint ' + id + ': ' + common.sanitizeError(e));
    }
  }
}

exports.rule = entities.Issue.onSchedule({
  title: 'SCP: remind participants to confirm Sprint availability',
  // Default: daily at 08:00. Quartz-style 6-field cron.
  cron: '0 0 8 * * ?',
  // SPIKE: verify on real YouTrack — search selecting issues on a board so we can
  // reach upcoming managed Sprints. Narrow for large instances.
  search: 'has: Board',
  action: function (ctx) {
    try {
      remindForIssue(ctx.issue);
    } catch (e) {
      // Reminders never block.
      console.error('scp: reminder action failed: ' + common.sanitizeError(e));
    }
  },
});
