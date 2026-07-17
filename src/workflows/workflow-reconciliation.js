/**
 * workflow-reconciliation.js — Issue.onSchedule rule (scheduled repair sweep).
 *
 * TRIGGER: Cron (default hourly, "0 0 * * * ?"). The scheduled search selects issues
 * that belong to managed Sprints; for each such issue we inspect its managed Sprints
 * and reconcile any that are flagged dirty (scpMetricsDirty === true).
 *
 * WHY on an ISSUE schedule: the scripting API's onSchedule iterates ISSUES, not
 * Sprints. We therefore reach Sprints through their member issues and DE-DUPLICATE so
 * a given Sprint is reconciled at most once per run.
 *
 * ALGORITHM (per matching issue):
 *   1. Enumerate the issue's managed Sprints.
 *   2. For each Sprint that is dirty AND not already reconciled this run:
 *        a. Recompute its aggregate effort ABSOLUTELY from its current issues
 *           (common.recomputeSprintFromScratch) — this fixes missed add/remove/delete
 *           events and any incremental drift, and clears scpMetricsDirty, setting
 *           scpDataIntegrityStatus='up-to-date' and scpLastRecalculatedAt.
 *        b. If the Sprint is completed, refresh its completion snapshot
 *           (common.refreshCompletionSnapshot).
 *
 * DE-DUPLICATION: two layers.
 *   - A module-level Set of reconciled Sprint ids (best-effort within a runtime).
 *   - Clearing scpMetricsDirty once reconciled, so later issues in the same Sprint
 *     see it clean and skip.
 *   SPIKE: verify on real YouTrack — (1) whether module-level state persists across
 *   the per-issue action invocations of a single onSchedule run, and (2) whether a
 *   scpMetricsDirty write made while processing one issue is visible when processing
 *   the next issue in the same run. If neither holds, dedup degrades to "reconcile
 *   each dirty Sprint once per member issue", which is correct but wasteful.
 *
 * FAILURE POLICY: Never throw out of the action; log and continue so one bad Sprint
 * does not abort the sweep.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

// SPIKE: verify on real YouTrack — module-level dedup state across a single run.
var reconciledThisRun = {};

/**
 * Reconcile one issue's dirty managed Sprints.
 * @param {object} issue
 */
function reconcileForIssue(issue) {
  var nowMs = Date.now();
  var sprints = common.getManagedSprints(issue);
  for (var i = 0; i < sprints.length; i++) {
    var sprint = sprints[i];
    var id = common.sprintId(sprint);
    if (!id) continue;
    if (reconciledThisRun[id]) continue; // already handled this run
    if (common.readExtProp(sprint, 'scpMetricsDirty') !== true) continue; // not dirty

    try {
      common.recomputeSprintFromScratch(sprint, nowMs);
      if (common.isCompletedSprint(sprint, nowMs)) {
        common.refreshCompletionSnapshot(sprint, nowMs);
      }
      reconciledThisRun[id] = true;
    } catch (e) {
      // Leave the Sprint dirty for the next run; record the error status.
      try {
        common.writeExtProp(sprint, 'scpDataIntegrityStatus', common.STATUS_ERROR);
      } catch {
        /* ignore */
      }
      console.error('scp: reconcile failed for sprint ' + id + ': ' + common.sanitizeError(e));
    }
  }
}

exports.rule = entities.Issue.onSchedule({
  title: 'SCP: reconcile dirty managed Sprint metrics',
  // Default: hourly, on the hour. Quartz-style 6-field cron.
  cron: '0 0 * * * ?',
  // SPIKE: verify on real YouTrack — a search that efficiently selects issues in
  // managed Sprints. There is no query term for the app's scpManaged Sprint flag, so
  // we match issues that are on a board (agile) and filter to managed Sprints in the
  // action. Narrow this query for large instances.
  search: 'has: Board',
  action: function (ctx) {
    try {
      reconcileForIssue(ctx.issue);
    } catch (e) {
      console.error('scp: reconciliation action failed: ' + common.sanitizeError(e));
    }
  },
});
