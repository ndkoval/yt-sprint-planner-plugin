/**
 * workflow-completed-sprint.js — Issue.onChange rule for post-finish corrections.
 *
 * TRIGGER: A change to an issue's resolution state, resolution timestamp, Original
 * Effort, or Sprint membership, where the affected managed Sprint is already
 * COMPLETED. This lets a completed Sprint's completion metrics be corrected without
 * reopening / re-finalizing it (spec: allow post-finish corrections).
 *
 * ALGORITHM:
 *   1. Recompute the issue's contribution to all affected managed Sprints
 *      (common.recomputeIssueMetrics keeps scpCompletedOriginalEffortMinutes current
 *      via snapshot-based deltas).
 *   2. For every touched Sprint that is COMPLETED, refresh its completion snapshot
 *      (Completed Original Effort, Observed Focus Factor = Completed / Raw with null
 *      when Raw <= 0, scpCompletionCalculationJson, scpCompletionCalculatedAt) via
 *      common.refreshCompletionSnapshot.
 *
 * FAILURE POLICY: Never block the issue edit. Errors are recorded on
 * scpWorkflowError and affected Sprints flagged 'needs-recalculation'.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

exports.rule = entities.Issue.onChange({
  title: 'SCP: correct completed Sprint completion metrics on issue change',
  guard: function () {
    // Permissive: whether an affected Sprint is completed is decided in the action,
    // and the recompute itself is snapshot-idempotent.
    return true;
  },
  action: function (ctx) {
    var nowMs = Date.now();
    try {
      var touched = common.recomputeIssueMetrics(ctx.issue);
      for (var i = 0; i < touched.length; i++) {
        if (common.isCompletedSprint(touched[i], nowMs)) {
          common.refreshCompletionSnapshot(touched[i], nowMs);
        }
      }
    } catch (e) {
      try {
        common.recordWorkflowError(ctx.issue, e, common.getManagedSprints(ctx.issue));
      } catch (inner) {
        console.error('scp: completed-sprint handler failed: ' + common.sanitizeError(inner));
      }
    }
  },
  requirements: {},
});
