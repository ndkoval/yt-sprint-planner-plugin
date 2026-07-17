/**
 * workflow-issue-metrics.js — Issue.onChange rule (spec §12.1).
 *
 * TRIGGER: Any change to an issue that can affect a managed Sprint's aggregated
 * effort metrics:
 *   - Original Effort field value (configurable field name)
 *   - Current Effort field value (configurable field name)
 *   - State transition resolved <-> unresolved
 *   - Resolution timestamp
 *   - Sprint (agile) membership
 *   - Issue creation
 *   - Project change
 *
 * ALGORITHM (delegated to common.recomputeIssueMetrics):
 *   1. Read the issue's PREVIOUS snapshot (scpMetricsSnapshotJson).
 *   2. Read the issue's CURRENT managed-Sprint membership (native Sprint is the only
 *      source of truth).
 *   3. Form the UNION of previous and current Sprint ids.
 *   4. For each affected Sprint apply the signed delta (old contribution -> new
 *      contribution) to scpOriginalEffortMinutes / scpCurrentEffortMinutes /
 *      scpCompletedOriginalEffortMinutes, bump scpMetricsRevision, and stamp
 *      scpLastWorkflowUpdateAt.
 *   5. Persist a fresh issue snapshot and bump scpWorkflowRevision.
 *
 * FAILURE POLICY: This rule MUST NOT block the user's issue edit. Any error is
 * caught, recorded as a sanitized string on scpWorkflowError, and every affected
 * Sprint is flagged 'needs-recalculation' so the scheduled reconciliation repairs it.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

exports.rule = entities.Issue.onChange({
  title: 'SCP: recompute Sprint effort metrics on issue change',
  guard: function () {
    // Permissive by design: the effort field names and Sprint membership are
    // configurable, and the recompute is snapshot-idempotent (a no-op when nothing
    // relevant changed), so running it on every change is safe and cheap.
    return true;
  },
  action: function (ctx) {
    try {
      common.recomputeIssueMetrics(ctx.issue);
    } catch (e) {
      // NEVER block the issue edit.
      try {
        common.recordWorkflowError(ctx.issue, e, common.getManagedSprints(ctx.issue));
      } catch (inner) {
        console.error('scp: failed to record workflow error: ' + common.sanitizeError(inner));
      }
    }
  },
  requirements: {},
});
