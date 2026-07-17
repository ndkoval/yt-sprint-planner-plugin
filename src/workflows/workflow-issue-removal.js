/**
 * workflow-issue-removal.js — Issue.onChange rule with runOn.removal (spec §12.1).
 *
 * TRIGGER: An issue is DELETED. On removal, its cached contribution must be
 * subtracted from every managed Sprint it belonged to.
 *
 * ALGORITHM:
 *   1. Read the issue's LAST snapshot (scpMetricsSnapshotJson).
 *   2. For each managed Sprint id in that snapshot, subtract the issue's recorded
 *      contribution (old contribution -> zero) from the Sprint's aggregate metrics.
 *   3. Flag each affected Sprint 'needs-recalculation' so reconciliation confirms.
 *
 * DOMAIN RULE: Never create a replacement / service issue. The native Sprint is the
 * only source of truth for membership; deletion simply removes the contribution.
 *
 * FAILURE POLICY: Removal must never be blocked. Errors are swallowed (logged) and
 * the affected Sprints are left dirty for reconciliation.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

var entities = require('@jetbrains/youtrack-scripting-api/entities');
var common = require('./workflow-common');

/**
 * Subtract a deleted issue's last-known contribution from its managed Sprints.
 * @param {object} issue The issue being removed.
 */
function subtractOnRemoval(issue) {
  var snapshot = common.parseIssueSnapshot(
    common.readExtProp(issue, 'scpMetricsSnapshotJson')
  );
  if (!snapshot) return; // nothing recorded -> nothing to subtract.

  var ids = Array.isArray(snapshot.managedSprintIds) ? snapshot.managedSprintIds : [];
  if (!ids.length) return;

  var prevState = {
    originalEffortMinutes: common.toMinutes(snapshot.originalEffortMinutes),
    currentEffortMinutes: common.toMinutes(snapshot.currentEffortMinutes),
    resolved: snapshot.resolved === true,
    resolvedAt: typeof snapshot.resolvedAt === 'number' ? snapshot.resolvedAt : null,
  };

  // The issue is being removed, so its live sprint handles may still be reachable
  // during the removal transaction.
  var reachable = {};
  var live = common.getManagedSprints(issue);
  for (var i = 0; i < live.length; i++) {
    reachable[common.sprintId(live[i])] = live[i];
  }

  for (var j = 0; j < ids.length; j++) {
    var sprint = reachable[ids[j]];
    if (!sprint) {
      // Cannot resolve the Sprint handle during removal — reconciliation over
      // managed Sprints will recompute from scratch. SPIKE below.
      console.warn('scp: removal could not resolve sprint ' + ids[j] + '; deferring to reconcile');
      continue;
    }
    var dates = common.getSprintDates(sprint);
    var oldContribution = common.issueContribution(prevState, dates.startMs, dates.finishMs);
    // Subtract: old -> zero.
    common.applyContributionDelta(sprint, oldContribution, common.emptyContribution());
    common.bumpMetricsRevision(sprint);
    common.stampWorkflowUpdate(sprint);
    // A deletion is a structural change; ask reconciliation to confirm the totals.
    common.markSprintDirty(sprint);
  }
}

exports.rule = entities.Issue.onChange({
  title: 'SCP: subtract effort contribution when an issue is removed',
  // SPIKE: verify on real YouTrack — `runOn.removal` selects the deletion event and
  // `ctx.issue.becomesRemoved` distinguishes it from an ordinary change.
  runOn: { change: false, removal: true },
  guard: function (ctx) {
    // SPIKE: verify on real YouTrack — becomesRemoved flag name for removal events.
    return ctx.issue.becomesRemoved === true;
  },
  action: function (ctx) {
    try {
      subtractOnRemoval(ctx.issue);
    } catch (e) {
      // Never block removal.
      console.error('scp: removal handler failed: ' + common.sanitizeError(e));
    }
  },
  requirements: {},
});
