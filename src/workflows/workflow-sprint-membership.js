/**
 * workflow-sprint-membership.js — Issue.onChange rule tracking Sprint membership.
 *
 * TRIGGER: An issue is added to a Sprint, removed from a Sprint, moved between
 * Sprints, or gains/loses membership in one of several Sprints (multi-Sprint
 * membership is supported — the native Sprint is the ONLY source of truth).
 *
 * ALGORITHM: Recompute the aggregated effort contribution for ALL affected Sprints
 * (the union of the previously-recorded managed Sprint ids and the current managed
 * Sprint ids). This reuses common.recomputeIssueMetrics, whose snapshot-based deltas
 * are idempotent, so it composes safely with workflow-issue-metrics running in the
 * same transaction: whichever runs second sees an already-updated snapshot and
 * produces a zero delta.
 *
 * DETECTION: We compare the current managed-Sprint id set against the set stored in
 * the last issue snapshot. When they differ (or there is no snapshot yet) membership
 * changed and we recompute.
 *
 * FAILURE POLICY: Must never block the issue edit. Errors are recorded on
 * scpWorkflowError and affected Sprints are flagged 'needs-recalculation'.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

/**
 * Return true when the issue's current managed-Sprint membership differs from the
 * membership recorded in its last snapshot.
 * @param {object} issue
 * @returns {boolean}
 */
function membershipChanged(issue) {
  var snapshot = common.parseIssueSnapshot(
    common.readExtProp(issue, 'scpMetricsSnapshotJson')
  );
  var prevIds =
    snapshot && Array.isArray(snapshot.managedSprintIds) ? snapshot.managedSprintIds : [];

  var current = common.getManagedSprints(issue);
  var currentIds = [];
  for (var i = 0; i < current.length; i++) {
    var id = common.sprintId(current[i]);
    if (id && currentIds.indexOf(id) === -1) currentIds.push(id);
  }

  if (prevIds.length !== currentIds.length) return true;
  for (var j = 0; j < currentIds.length; j++) {
    if (prevIds.indexOf(currentIds[j]) === -1) return true;
  }
  return false;
}

exports.rule = entities.Issue.onChange({
  title: 'SCP: recompute Sprint metrics on Sprint membership change',
  guard: function (ctx) {
    try {
      return membershipChanged(ctx.issue);
    } catch {
      // If we cannot determine membership, be conservative and run.
      return true;
    }
  },
  action: function (ctx) {
    try {
      common.recomputeIssueMetrics(ctx.issue);
    } catch (e) {
      try {
        common.recordWorkflowError(ctx.issue, e, common.getManagedSprints(ctx.issue));
      } catch (inner) {
        console.error('scp: membership handler failed: ' + common.sanitizeError(inner));
      }
    }
  },
  requirements: {},
});
