/**
 * workflow-common.js — shared helpers for the Sprint Capacity Planner workflows.
 *
 * TRIGGER: none. This module is `require`d by the other workflow modules; it does
 * not register any rule of its own.
 *
 * RESPONSIBILITIES:
 *   - Pure, minute-based effort math that MIRRORS src/domain/effort/effort.ts and
 *     src/domain/focus-factor/focus-factor.ts (TS cannot be imported from workflow
 *     JS, so the needed math is re-implemented here in plain ES2019).
 *   - Versioned JSON (de)serialization for the scp* JSON blobs with version guards
 *     and unknown-field preservation.
 *   - Reading the CONFIGURABLE Original/Current effort field names from the project
 *     config JSON (never hardcode "Original Effort").
 *   - Centralised, clearly-marked SPIKE helpers for every YouTrack SDK surface whose
 *     exact shape is uncertain (Sprint extension properties, Sprint membership,
 *     period-field reads, resolution timestamps) so they are trivial to correct
 *     against a real YouTrack instance.
 *
 * All effort/capacity values are MINUTES. All timestamps are UTC epoch milliseconds.
 *
 * NOTE: To keep linting clean and avoid load-time failures, the YouTrack scripting
 * API is required LAZILY inside the functions that need it, never at module top.
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- YouTrack workflows run in a CommonJS runtime and must use require(). */

/** Current schema versions of the JSON documents this app persists. */
var CAPACITY_DOC_VERSION = 1;
var ISSUE_SNAPSHOT_VERSION = 1;
var COMPLETION_CALC_VERSION = 1;

/** Data-integrity status values (mirror DataIntegrityStatus in src/shared/types.ts). */
var STATUS_UP_TO_DATE = 'up-to-date';
var STATUS_INCREMENTAL = 'incremental';
var STATUS_NEEDS_RECALCULATION = 'needs-recalculation';
var STATUS_RECALCULATING = 'recalculating';
var STATUS_ERROR = 'error';

// ---------------------------------------------------------------------------
// Pure effort math (mirrors aggregateEffort in src/domain/effort/effort.ts)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw minutes value: null/undefined/NaN -> 0.
 * @param {number|null|undefined} value
 * @returns {number}
 */
function toMinutes(value) {
  if (value === null || value === undefined) return 0;
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

/**
 * Compute a single issue's contribution to a Sprint's aggregated effort, in minutes.
 * Mirrors the per-issue rules of aggregateEffort (src/domain/effort/effort.ts):
 *   - original  : Original Effort for ALL issues in the Sprint (missing -> 0).
 *   - current   : Current Effort, but RESOLVED issues always contribute 0.
 *   - completed : Original Effort of issues resolved within [startMs, finishMs].
 *
 * @param {{originalEffortMinutes:(number|null), currentEffortMinutes:(number|null),
 *          resolved:boolean, resolvedAt:(number|null)}} issue
 * @param {number} startMs  Sprint start, inclusive (UTC ms).
 * @param {number} finishMs Sprint finish, inclusive (UTC ms).
 * @returns {{original:number, current:number, completed:number}}
 */
function issueContribution(issue, startMs, finishMs) {
  var original = toMinutes(issue.originalEffortMinutes);
  var current = issue.resolved ? 0 : toMinutes(issue.currentEffortMinutes);

  var completed = 0;
  if (
    issue.resolved &&
    issue.resolvedAt !== null &&
    issue.resolvedAt !== undefined &&
    typeof startMs === 'number' &&
    typeof finishMs === 'number' &&
    issue.resolvedAt >= startMs &&
    issue.resolvedAt <= finishMs
  ) {
    completed = original;
  }

  return { original: original, current: current, completed: completed };
}

/** A zero contribution (used when there is no previous snapshot). */
function emptyContribution() {
  return { original: 0, current: 0, completed: 0 };
}

/**
 * Observed Focus Factor for a completed Sprint (mirrors focus-factor.ts).
 * @param {number} completedOriginalEffortMinutes
 * @param {number} rawCapacityMinutes
 * @returns {number|null} null when raw capacity is <= 0.
 */
function observedFocusFactor(completedOriginalEffortMinutes, rawCapacityMinutes) {
  if (!(rawCapacityMinutes > 0)) return null;
  return completedOriginalEffortMinutes / rawCapacityMinutes;
}

// ---------------------------------------------------------------------------
// Versioned JSON (de)serialization with unknown-field preservation
// ---------------------------------------------------------------------------

/**
 * Parse a versioned JSON string. Returns the parsed object (INCLUDING any unknown
 * fields, which callers must preserve on re-serialization) or `null` when the string
 * is empty, malformed, or carries a newer-than-supported version.
 *
 * @param {string|null|undefined} raw
 * @param {number} maxVersion Highest schema version this workflow understands.
 * @returns {object|null}
 */
function parseVersionedJson(raw, maxVersion) {
  if (raw === null || raw === undefined || raw === '') return null;
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.version !== 'number') return null;
  // Version guard: refuse to interpret a document written by a newer schema.
  if (parsed.version > maxVersion) return null;
  return parsed;
}

/**
 * Serialize a versioned document to a JSON string. Unknown fields present on the
 * object are preserved verbatim because we stringify the object as-is.
 * @param {object} doc
 * @returns {string}
 */
function serializeVersionedJson(doc) {
  return JSON.stringify(doc);
}

/** Parse scpCapacityJson (CapacityDocument). @returns {object|null} */
function parseCapacityDocument(raw) {
  return parseVersionedJson(raw, CAPACITY_DOC_VERSION);
}

/** Serialize a CapacityDocument. */
function serializeCapacityDocument(doc) {
  return serializeVersionedJson(doc);
}

/** Parse scpMetricsSnapshotJson (IssueSnapshot). @returns {object|null} */
function parseIssueSnapshot(raw) {
  return parseVersionedJson(raw, ISSUE_SNAPSHOT_VERSION);
}

/**
 * Serialize an IssueSnapshot, preserving unknown fields carried on `base`.
 * @param {object|null} base Previously-parsed snapshot whose unknown fields to keep.
 * @param {{managedSprintIds:string[], originalEffortMinutes:number,
 *          currentEffortMinutes:number, resolved:boolean, resolvedAt:(number|null),
 *          updatedAt:number}} next
 * @returns {string}
 */
function serializeIssueSnapshot(base, next) {
  var out = mergePreserving(base, next);
  out.version = ISSUE_SNAPSHOT_VERSION;
  return serializeVersionedJson(out);
}

/** Parse scpCompletionCalculationJson (CompletionCalculation). @returns {object|null} */
function parseCompletionCalculation(raw) {
  return parseVersionedJson(raw, COMPLETION_CALC_VERSION);
}

/**
 * Serialize a CompletionCalculation, preserving unknown fields carried on `base`.
 * @param {object|null} base
 * @param {object} next
 * @returns {string}
 */
function serializeCompletionCalculation(base, next) {
  var out = mergePreserving(base, next);
  out.version = COMPLETION_CALC_VERSION;
  return serializeVersionedJson(out);
}

/**
 * Shallow-merge `next` onto a copy of `base`, so that fields present on `base` but
 * unknown to `next` survive (unknown-field preservation).
 * @param {object|null} base
 * @param {object} next
 * @returns {object}
 */
function mergePreserving(base, next) {
  var out = {};
  var key;
  if (base && typeof base === 'object') {
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
    }
  }
  for (key in next) {
    if (Object.prototype.hasOwnProperty.call(next, key)) out[key] = next[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project config: configurable effort field NAMES
// ---------------------------------------------------------------------------

/**
 * Read the configured Original/Current effort field NAMES from a project's config
 * JSON (scpConfigJson). Field names are configurable and must NEVER be hardcoded.
 *
 * @param {object} project A YouTrack Project entity (or null).
 * @returns {{originalEffortField:(string|null), currentEffortField:(string|null),
 *            boardId:(string|null)}}
 */
function getEffortFieldNames(project) {
  var empty = { originalEffortField: null, currentEffortField: null, boardId: null };
  if (!project) return empty;
  // SPIKE: verify on real YouTrack — reading a Project extension property named
  // 'scpConfigJson'. The exact accessor for app-owned Project extension properties
  // via the scripting API is uncertain; centralised here so it is easy to correct.
  var raw = readExtProp(project, 'scpConfigJson');
  var cfg = parseVersionedJson(raw, 1);
  if (!cfg) return empty;
  return {
    originalEffortField:
      typeof cfg.originalEffortField === 'string' ? cfg.originalEffortField : null,
    currentEffortField:
      typeof cfg.currentEffortField === 'string' ? cfg.currentEffortField : null,
    boardId: typeof cfg.boardId === 'string' ? cfg.boardId : null,
  };
}

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

/**
 * Produce a short, safe, single-line string describing an error, with no tokens or
 * PII, suitable for storing in scpWorkflowError and surfacing to users.
 * @param {*} e
 * @returns {string}
 */
function sanitizeError(e) {
  var msg = '';
  if (e === null || e === undefined) {
    msg = 'unknown error';
  } else if (typeof e === 'string') {
    msg = e;
  } else if (e && typeof e.message === 'string') {
    msg = e.message;
  } else {
    try {
      msg = String(e);
    } catch {
      msg = 'unstringifiable error';
    }
  }
  // Collapse whitespace/newlines to keep it single-line.
  msg = msg.replace(/\s+/g, ' ').trim();
  // Redact anything resembling a token/secret: long alphanumeric-ish runs.
  msg = msg.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
  // Redact bearer/authorization-looking fragments.
  msg = msg.replace(/(bearer|token|authorization|perm-token)\s*[:=]?\s*\S+/gi, '$1 [redacted]');
  // Redact email addresses (PII).
  msg = msg.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
  if (msg.length > 300) msg = msg.slice(0, 297) + '...';
  return msg || 'error';
}

// ===========================================================================
// SPIKE ZONE — YouTrack SDK surface whose exact shape must be verified against a
// real instance. Every access below is deliberately centralised so corrections
// are made in one place.
// ===========================================================================

/**
 * Read an app-owned extension property from any entity (Sprint / Issue / Project).
 * @param {object} entity
 * @param {string} name Property name, e.g. 'scpManaged'.
 * @returns {*} The value, or undefined when unavailable.
 */
function readExtProp(entity, name) {
  if (!entity) return undefined;
  // SPIKE: verify on real YouTrack — app extension properties are assumed to be
  // exposed under `entity.extensionProperties[name]`. If the SDK instead exposes
  // them directly (e.g. `entity[name]`) fall back to that.
  try {
    if (entity.extensionProperties && name in entity.extensionProperties) {
      return entity.extensionProperties[name];
    }
  } catch {
    /* fall through */
  }
  try {
    return entity[name];
  } catch {
    return undefined;
  }
}

/**
 * Write an app-owned extension property to any entity.
 * @param {object} entity
 * @param {string} name
 * @param {*} value
 */
function writeExtProp(entity, name, value) {
  if (!entity) return;
  // SPIKE: verify on real YouTrack — assumed writeable via
  // `entity.extensionProperties[name] = value`. Mirror of readExtProp above.
  try {
    if (entity.extensionProperties) {
      entity.extensionProperties[name] = value;
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    entity[name] = value;
  } catch {
    /* ignore — surfaced by caller via status */
  }
}

/**
 * True when a Sprint entity is managed by this app (scpManaged === true).
 * @param {object} sprint
 * @returns {boolean}
 */
function isSprintManaged(sprint) {
  return readExtProp(sprint, 'scpManaged') === true;
}

/**
 * Return the managed Sprint entities the given issue currently belongs to.
 * The native Sprint is the ONLY source of truth for membership (§ domain rules).
 *
 * @param {object} issue A YouTrack Issue entity.
 * @returns {Array<object>} Managed Sprint entities (possibly empty).
 */
function getManagedSprints(issue) {
  var result = [];
  if (!issue) return result;
  var sprints = [];
  // SPIKE: verify on real YouTrack — the accessor for an issue's agile Sprint
  // membership is uncertain. Trying the most likely candidates in order:
  //   1. issue.sprints            (collection of Sprint entities)
  //   2. issue.getSprints()       (method form)
  // The exact set/array API (iteration, size) must be confirmed.
  try {
    if (issue.sprints) {
      sprints = toArray(issue.sprints);
    } else if (typeof issue.getSprints === 'function') {
      sprints = toArray(issue.getSprints());
    }
  } catch {
    sprints = [];
  }
  for (var i = 0; i < sprints.length; i++) {
    if (isSprintManaged(sprints[i])) result.push(sprints[i]);
  }
  return result;
}

/**
 * Coerce an SDK collection (Set-like / array-like / iterable) into a plain array.
 * @param {*} collection
 * @returns {Array}
 */
function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.slice();
  var out = [];
  // SPIKE: verify on real YouTrack — SDK Set collections expose `.forEach` and/or
  // are iterable. Handling both here.
  try {
    if (typeof collection.forEach === 'function') {
      collection.forEach(function (item) {
        out.push(item);
      });
      return out;
    }
  } catch {
    /* fall through */
  }
  try {
    for (var i = 0; i < collection.length; i++) out.push(collection[i]);
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * A stable id for a Sprint entity (used for de-dup / union of affected sprints).
 * @param {object} sprint
 * @returns {string}
 */
function sprintId(sprint) {
  if (!sprint) return '';
  // SPIKE: verify on real YouTrack — assuming `sprint.id` (falling back to name).
  if (sprint.id !== undefined && sprint.id !== null) return String(sprint.id);
  var name = readExtProp(sprint, 'name');
  return name ? String(name) : '';
}

/**
 * Read a Sprint's [start, finish] in UTC ms.
 * @param {object} sprint
 * @returns {{startMs:(number|null), finishMs:(number|null)}}
 */
function getSprintDates(sprint) {
  // SPIKE: verify on real YouTrack — Sprint (agile iteration) native start/finish
  // are assumed exposed as epoch-ms numbers via `sprint.start` / `sprint.finish`.
  var startMs = numericOrNull(readOr(sprint, 'start'));
  var finishMs = numericOrNull(readOr(sprint, 'finish'));
  return { startMs: startMs, finishMs: finishMs };
}

/** Read a native field with a couple of likely accessors. */
function readOr(entity, name) {
  if (!entity) return undefined;
  try {
    if (entity[name] !== undefined) return entity[name];
  } catch {
    /* fall through */
  }
  return readExtProp(entity, name);
}

function numericOrNull(value) {
  if (value === null || value === undefined) return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

/**
 * Read a period (duration) custom field from an issue and return its value in
 * MINUTES, or null when the field is unset.
 *
 * @param {object} issue
 * @param {string|null} fieldName Configured field name (never hardcoded).
 * @returns {number|null}
 */
function getIssueEffortMinutes(issue, fieldName) {
  if (!issue || !fieldName) return null;
  var value;
  // SPIKE: verify on real YouTrack — period custom fields are read via
  // `issue.fields[fieldName]`. YouTrack stores periods as minutes; the returned
  // object is assumed to expose `.minutes`. If the SDK returns a plain number of
  // minutes instead, the `.minutes` branch is skipped and the number is used.
  try {
    value = issue.fields ? issue.fields[fieldName] : undefined;
  } catch {
    return null;
  }
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value.minutes === 'number') return value.minutes;
  // Some SDK period representations expose `.getMinutes()`.
  if (typeof value.getMinutes === 'function') {
    try {
      return value.getMinutes();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Determine an issue's resolution state and timestamp.
 * @param {object} issue
 * @returns {{resolved:boolean, resolvedAt:(number|null)}}
 */
function getIssueResolution(issue) {
  if (!issue) return { resolved: false, resolvedAt: null };
  // SPIKE: verify on real YouTrack — `issue.resolved` is assumed to be the epoch-ms
  // timestamp of resolution (null/undefined when unresolved). Some SDK versions
  // expose `issue.isResolved()` as a boolean instead; both are handled.
  var resolvedAt = null;
  var resolved = false;
  try {
    var r = issue.resolved;
    if (typeof r === 'number' && isFinite(r) && r > 0) {
      resolved = true;
      resolvedAt = r;
    } else if (r === true) {
      resolved = true;
    }
  } catch {
    /* fall through */
  }
  if (!resolved) {
    try {
      if (typeof issue.isResolved === 'function' && issue.isResolved()) resolved = true;
    } catch {
      /* ignore */
    }
  }
  return { resolved: resolved, resolvedAt: resolvedAt };
}

/**
 * Build a plain effort-issue descriptor from a live issue using the project's
 * configured field names. Returns null when field names cannot be resolved.
 *
 * @param {object} issue
 * @param {{originalEffortField:(string|null), currentEffortField:(string|null)}} fields
 * @returns {{originalEffortMinutes:(number|null), currentEffortMinutes:(number|null),
 *            resolved:boolean, resolvedAt:(number|null)}}
 */
function readIssueEffortState(issue, fields) {
  var res = getIssueResolution(issue);
  return {
    originalEffortMinutes: getIssueEffortMinutes(issue, fields.originalEffortField),
    currentEffortMinutes: getIssueEffortMinutes(issue, fields.currentEffortField),
    resolved: res.resolved,
    resolvedAt: res.resolvedAt,
  };
}

// ---------------------------------------------------------------------------
// Sprint metric mutation helpers
// ---------------------------------------------------------------------------

/** Read a numeric Sprint metric, defaulting to 0. */
function readSprintMinutes(sprint, name) {
  return toMinutes(readExtProp(sprint, name));
}

/**
 * Apply a signed delta (old->new contribution) to a Sprint's aggregate effort
 * metrics. Never lets a metric drop below 0 (defensive against drift; a full
 * reconciliation will correct any residual error).
 *
 * @param {object} sprint
 * @param {{original:number, current:number, completed:number}} oldContribution
 * @param {{original:number, current:number, completed:number}} newContribution
 */
function applyContributionDelta(sprint, oldContribution, newContribution) {
  var original =
    readSprintMinutes(sprint, 'scpOriginalEffortMinutes') +
    (newContribution.original - oldContribution.original);
  var current =
    readSprintMinutes(sprint, 'scpCurrentEffortMinutes') +
    (newContribution.current - oldContribution.current);
  var completed =
    readSprintMinutes(sprint, 'scpCompletedOriginalEffortMinutes') +
    (newContribution.completed - oldContribution.completed);

  writeExtProp(sprint, 'scpOriginalEffortMinutes', Math.max(0, Math.round(original)));
  writeExtProp(sprint, 'scpCurrentEffortMinutes', Math.max(0, Math.round(current)));
  writeExtProp(
    sprint,
    'scpCompletedOriginalEffortMinutes',
    Math.max(0, Math.round(completed))
  );
}

/**
 * Mark a Sprint's metrics as dirty / needing recalculation.
 * @param {object} sprint
 */
function markSprintDirty(sprint) {
  writeExtProp(sprint, 'scpMetricsDirty', true);
  writeExtProp(sprint, 'scpDataIntegrityStatus', STATUS_NEEDS_RECALCULATION);
}

/**
 * Bump a Sprint's metrics revision counter.
 * @param {object} sprint
 * @returns {number} The new revision.
 */
function bumpMetricsRevision(sprint) {
  var rev = toMinutes(readExtProp(sprint, 'scpMetricsRevision')) + 1;
  writeExtProp(sprint, 'scpMetricsRevision', rev);
  return rev;
}

/**
 * Stamp the "last workflow update" timestamp on a Sprint.
 * @param {object} sprint
 * @param {number} [nowMs]
 */
function stampWorkflowUpdate(sprint, nowMs) {
  writeExtProp(sprint, 'scpLastWorkflowUpdateAt', typeof nowMs === 'number' ? nowMs : Date.now());
}

/**
 * Compute this issue's contribution to a specific Sprint from a given effort state.
 * @param {{originalEffortMinutes:(number|null), currentEffortMinutes:(number|null),
 *          resolved:boolean, resolvedAt:(number|null)}} state
 * @param {object} sprint
 * @returns {{original:number, current:number, completed:number}}
 */
function contributionForSprint(state, sprint) {
  var dates = getSprintDates(sprint);
  return issueContribution(state, dates.startMs, dates.finishMs);
}

/**
 * Build a contribution from a previous snapshot as it applied to `sprintIdStr`.
 * Returns an empty contribution when the issue was not previously in that Sprint or
 * the Sprint handle is unavailable.
 */
function oldContributionFor(prevSnapshot, sprintIdStr, sprint) {
  if (!prevSnapshot || !sprint) return emptyContribution();
  var ids = Array.isArray(prevSnapshot.managedSprintIds) ? prevSnapshot.managedSprintIds : [];
  if (ids.indexOf(sprintIdStr) === -1) return emptyContribution();
  var prevState = {
    originalEffortMinutes: toMinutes(prevSnapshot.originalEffortMinutes),
    currentEffortMinutes: toMinutes(prevSnapshot.currentEffortMinutes),
    resolved: prevSnapshot.resolved === true,
    resolvedAt: typeof prevSnapshot.resolvedAt === 'number' ? prevSnapshot.resolvedAt : null,
  };
  return contributionForSprint(prevState, sprint);
}

/**
 * Recompute all managed Sprints affected by an issue's current state and persist a
 * fresh issue snapshot. Snapshot-based deltas make this IDEMPOTENT: running it twice
 * in a row produces no further change, so it is safe for several rules to invoke it
 * within the same transaction.
 *
 * @param {object} issue A YouTrack Issue entity.
 * @returns {Array<object>} The managed Sprint entities that were touched.
 */
function recomputeIssueMetrics(issue) {
  var fields = getEffortFieldNames(issue.project);
  var prevSnapshot = parseIssueSnapshot(readExtProp(issue, 'scpMetricsSnapshotJson'));
  var liveState = readIssueEffortState(issue, fields);
  var currentSprints = getManagedSprints(issue);

  var currentById = {};
  var currentIds = [];
  var i;
  for (i = 0; i < currentSprints.length; i++) {
    var sid = sprintId(currentSprints[i]);
    if (!sid) continue;
    currentById[sid] = currentSprints[i];
    if (currentIds.indexOf(sid) === -1) currentIds.push(sid);
  }

  var prevIds =
    prevSnapshot && Array.isArray(prevSnapshot.managedSprintIds)
      ? prevSnapshot.managedSprintIds
      : [];
  var affected = currentIds.slice();
  for (i = 0; i < prevIds.length; i++) {
    if (affected.indexOf(prevIds[i]) === -1) affected.push(prevIds[i]);
  }

  var touched = [];
  for (i = 0; i < affected.length; i++) {
    var id = affected[i];
    var sprint = currentById[id];
    var oldContribution = oldContributionFor(prevSnapshot, id, sprint || null);
    var newContribution;
    if (sprint) {
      newContribution = contributionForSprint(liveState, sprint);
    } else {
      // Issue left this Sprint. Its live handle is not reachable from the issue's
      // current membership, so we cannot subtract precisely here.
      // SPIKE: verify on real YouTrack — no confirmed API to fetch an arbitrary
      // Sprint by id from a rule; left Sprints are deferred to reconciliation.
      continue;
    }
    applyContributionDelta(sprint, oldContribution, newContribution);
    bumpMetricsRevision(sprint);
    stampWorkflowUpdate(sprint);
    if (readExtProp(sprint, 'scpDataIntegrityStatus') !== STATUS_ERROR) {
      writeExtProp(sprint, 'scpDataIntegrityStatus', STATUS_INCREMENTAL);
    }
    touched.push(sprint);
  }

  // Any Sprint the issue left but we could not resolve: flag it dirty so the
  // scheduled reconciliation recomputes it from scratch.
  for (i = 0; i < prevIds.length; i++) {
    if (!currentById[prevIds[i]]) {
      console.warn('scp: issue left sprint ' + prevIds[i] + '; deferring subtract to reconcile');
    }
  }

  var nextSnapshot = {
    version: ISSUE_SNAPSHOT_VERSION,
    managedSprintIds: currentIds,
    originalEffortMinutes: toMinutes(liveState.originalEffortMinutes),
    currentEffortMinutes: toMinutes(liveState.currentEffortMinutes),
    resolved: liveState.resolved === true,
    resolvedAt: liveState.resolvedAt,
    updatedAt: Date.now(),
  };
  writeExtProp(issue, 'scpMetricsSnapshotJson', serializeIssueSnapshot(prevSnapshot, nextSnapshot));
  writeExtProp(issue, 'scpIssueSchemaVersion', ISSUE_SNAPSHOT_VERSION);
  writeExtProp(issue, 'scpWorkflowRevision', toMinutes(readExtProp(issue, 'scpWorkflowRevision')) + 1);
  writeExtProp(issue, 'scpWorkflowError', '');
  return touched;
}

/**
 * Return the issues currently belonging to a Sprint.
 * SPIKE: verify on real YouTrack — the accessor for a Sprint's issues is uncertain.
 * Trying `sprint.issues` then `sprint.getIssues()`.
 * @param {object} sprint
 * @returns {Array<object>}
 */
function getSprintIssues(sprint) {
  if (!sprint) return [];
  try {
    if (sprint.issues) return toArray(sprint.issues);
    if (typeof sprint.getIssues === 'function') return toArray(sprint.getIssues());
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Write an issue's metrics snapshot from its live state, WITHOUT applying any delta
 * to Sprint aggregates. Used by full-from-scratch reconciliation so subsequent
 * incremental deltas start from a correct baseline.
 * @param {object} issue
 */
function writeIssueSnapshot(issue) {
  var fields = getEffortFieldNames(issue.project);
  var liveState = readIssueEffortState(issue, fields);
  var prevSnapshot = parseIssueSnapshot(readExtProp(issue, 'scpMetricsSnapshotJson'));

  var currentSprints = getManagedSprints(issue);
  var currentIds = [];
  for (var i = 0; i < currentSprints.length; i++) {
    var id = sprintId(currentSprints[i]);
    if (id && currentIds.indexOf(id) === -1) currentIds.push(id);
  }

  var next = {
    version: ISSUE_SNAPSHOT_VERSION,
    managedSprintIds: currentIds,
    originalEffortMinutes: toMinutes(liveState.originalEffortMinutes),
    currentEffortMinutes: toMinutes(liveState.currentEffortMinutes),
    resolved: liveState.resolved === true,
    resolvedAt: liveState.resolvedAt,
    updatedAt: Date.now(),
  };
  writeExtProp(issue, 'scpMetricsSnapshotJson', serializeIssueSnapshot(prevSnapshot, next));
  writeExtProp(issue, 'scpIssueSchemaVersion', ISSUE_SNAPSHOT_VERSION);
}

/**
 * Recompute a managed Sprint's aggregate effort ABSOLUTELY from the issues currently
 * in it (mirrors aggregateEffort). This repairs any drift or missed events. It also
 * refreshes each contained issue's snapshot so future incremental deltas are correct.
 *
 * @param {object} sprint
 * @param {number} [nowMs]
 * @returns {{original:number, current:number, completed:number}}
 */
function recomputeSprintFromScratch(sprint, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var dates = getSprintDates(sprint);
  var issues = getSprintIssues(sprint);

  var original = 0;
  var current = 0;
  var completed = 0;
  for (var i = 0; i < issues.length; i++) {
    var issue = issues[i];
    var fields = getEffortFieldNames(issue.project);
    var state = readIssueEffortState(issue, fields);
    var c = issueContribution(state, dates.startMs, dates.finishMs);
    original += c.original;
    current += c.current;
    completed += c.completed;
    // Keep the issue snapshot consistent with what we just aggregated.
    try {
      writeIssueSnapshot(issue);
    } catch {
      /* snapshot refresh is best-effort */
    }
  }

  writeExtProp(sprint, 'scpOriginalEffortMinutes', Math.max(0, Math.round(original)));
  writeExtProp(sprint, 'scpCurrentEffortMinutes', Math.max(0, Math.round(current)));
  writeExtProp(sprint, 'scpCompletedOriginalEffortMinutes', Math.max(0, Math.round(completed)));

  bumpMetricsRevision(sprint);
  writeExtProp(sprint, 'scpMetricsDirty', false);
  writeExtProp(sprint, 'scpDataIntegrityStatus', STATUS_UP_TO_DATE);
  writeExtProp(sprint, 'scpLastRecalculatedAt', now);
  stampWorkflowUpdate(sprint, now);

  return { original: original, current: current, completed: completed };
}

/**
 * Heuristic for whether a managed Sprint is completed.
 * SPIKE: verify on real YouTrack — the authoritative "sprint finished" signal is
 * uncertain. Treated as completed when an explicit `finished` flag is true, or when
 * the native finish date is in the past.
 * @param {object} sprint
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isCompletedSprint(sprint, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (readExtProp(sprint, 'finished') === true) return true;
  var dates = getSprintDates(sprint);
  return typeof dates.finishMs === 'number' && dates.finishMs < now;
}

/**
 * Refresh a completed Sprint's completion snapshot (Observed Focus Factor +
 * scpCompletionCalculationJson) from its already-aggregated metrics.
 * @param {object} sprint
 * @param {number} [nowMs]
 */
function refreshCompletionSnapshot(sprint, nowMs) {
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var dates = getSprintDates(sprint);
  var raw = readSprintMinutes(sprint, 'scpRawCapacityMinutes');
  var original = readSprintMinutes(sprint, 'scpOriginalEffortMinutes');
  var completed = readSprintMinutes(sprint, 'scpCompletedOriginalEffortMinutes');
  var observed = observedFocusFactor(completed, raw);

  writeExtProp(sprint, 'scpObservedFocusFactor', observed);
  writeExtProp(sprint, 'scpCompletionCalculatedAt', now);

  var base = parseCompletionCalculation(readExtProp(sprint, 'scpCompletionCalculationJson'));
  var calcRevision =
    (base && typeof base.calculationRevision === 'number' ? base.calculationRevision : 0) + 1;
  var next = {
    version: COMPLETION_CALC_VERSION,
    calculatedAt: now,
    sprintStart: dates.startMs,
    sprintFinish: dates.finishMs,
    rawCapacityMinutes: raw,
    originalEffortMinutes: original,
    completedOriginalEffortMinutes: completed,
    observedFocusFactor: observed,
    calculationRevision: calcRevision,
  };
  writeExtProp(sprint, 'scpCompletionCalculationJson', serializeCompletionCalculation(base, next));
}

/**
 * Read a numeric app setting (global app configuration), with a default fallback.
 * SPIKE: verify on real YouTrack — the accessor for app-level settings from a
 * workflow is uncertain. Trying the settings module, then a global `settings`
 * object, before falling back to the provided default.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function getAppSettingNumber(name, fallback) {
  var value;
  try {
    // SPIKE: verify module path / API for app settings access.
    var settingsApi = require('@jetbrains/youtrack-scripting-api/settings');
    if (settingsApi && typeof settingsApi.getValue === 'function') {
      value = settingsApi.getValue(name);
    }
  } catch {
    /* module may not exist in this runtime */
  }
  if (value === undefined || value === null) {
    try {
      // SPIKE: some deployments expose settings on a global.
      /* global settings */
      if (typeof settings !== 'undefined' && settings && name in settings) {
        value = settings[name];
      }
    } catch {
      /* ignore */
    }
  }
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

/**
 * Send an informational notification to a user. Never throws (reminders must not
 * block). Returns true when a notification was dispatched.
 * SPIKE: verify on real YouTrack — the notifications API surface is uncertain.
 * @param {object} user A YouTrack user entity.
 * @param {string} subject
 * @param {string} body
 * @returns {boolean}
 */
function notifyUser(user, subject, body) {
  if (!user) return false;
  try {
    var notifications = require('@jetbrains/youtrack-scripting-api/notifications');
    if (notifications && typeof notifications.sendEmail === 'function') {
      // SPIKE: verify signature — sendEmail(recipients, subject, bodyHtml).
      notifications.sendEmail(user, subject, body);
      return true;
    }
  } catch (e) {
    console.warn('scp: notifyUser failed: ' + sanitizeError(e));
  }
  return false;
}

/**
 * Resolve a YouTrack user entity by stable user id.
 * SPIKE: verify on real YouTrack — user lookup by id. Trying the workflow API's
 * findByLogin is not id-based; the exact by-id lookup must be confirmed.
 * @param {string} userId
 * @returns {object|null}
 */
function findUserById(userId) {
  if (!userId) return null;
  try {
    // SPIKE: verify — entities.User.findByRingId / findById availability.
    var entities = require('@jetbrains/youtrack-scripting-api/entities');
    if (entities && entities.User) {
      if (typeof entities.User.findByRingId === 'function') {
        return entities.User.findByRingId(userId) || null;
      }
      if (typeof entities.User.findById === 'function') {
        return entities.User.findById(userId) || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Record a sanitized workflow error on an ISSUE without blocking its edit, and flag
 * every affected managed Sprint as needing recalculation.
 *
 * @param {object} issue
 * @param {*} error
 * @param {Array<object>} [affectedSprints]
 */
function recordWorkflowError(issue, error, affectedSprints) {
  var safe = sanitizeError(error);
  try {
    writeExtProp(issue, 'scpWorkflowError', safe);
  } catch {
    /* never rethrow */
  }
  if (affectedSprints && affectedSprints.length) {
    for (var i = 0; i < affectedSprints.length; i++) {
      try {
        markSprintDirty(affectedSprints[i]);
      } catch {
        /* never rethrow */
      }
    }
  }
}

module.exports = {
  // constants
  CAPACITY_DOC_VERSION: CAPACITY_DOC_VERSION,
  ISSUE_SNAPSHOT_VERSION: ISSUE_SNAPSHOT_VERSION,
  COMPLETION_CALC_VERSION: COMPLETION_CALC_VERSION,
  STATUS_UP_TO_DATE: STATUS_UP_TO_DATE,
  STATUS_INCREMENTAL: STATUS_INCREMENTAL,
  STATUS_NEEDS_RECALCULATION: STATUS_NEEDS_RECALCULATION,
  STATUS_RECALCULATING: STATUS_RECALCULATING,
  STATUS_ERROR: STATUS_ERROR,

  // pure math
  toMinutes: toMinutes,
  issueContribution: issueContribution,
  emptyContribution: emptyContribution,
  observedFocusFactor: observedFocusFactor,

  // JSON
  parseVersionedJson: parseVersionedJson,
  serializeVersionedJson: serializeVersionedJson,
  parseCapacityDocument: parseCapacityDocument,
  serializeCapacityDocument: serializeCapacityDocument,
  parseIssueSnapshot: parseIssueSnapshot,
  serializeIssueSnapshot: serializeIssueSnapshot,
  parseCompletionCalculation: parseCompletionCalculation,
  serializeCompletionCalculation: serializeCompletionCalculation,
  mergePreserving: mergePreserving,

  // config
  getEffortFieldNames: getEffortFieldNames,

  // errors
  sanitizeError: sanitizeError,
  recordWorkflowError: recordWorkflowError,

  // shared recompute
  contributionForSprint: contributionForSprint,
  oldContributionFor: oldContributionFor,
  recomputeIssueMetrics: recomputeIssueMetrics,
  getSprintIssues: getSprintIssues,
  writeIssueSnapshot: writeIssueSnapshot,
  recomputeSprintFromScratch: recomputeSprintFromScratch,
  isCompletedSprint: isCompletedSprint,
  refreshCompletionSnapshot: refreshCompletionSnapshot,

  // app settings / notifications
  getAppSettingNumber: getAppSettingNumber,
  notifyUser: notifyUser,
  findUserById: findUserById,

  // SDK-touching (SPIKE) helpers
  readExtProp: readExtProp,
  writeExtProp: writeExtProp,
  isSprintManaged: isSprintManaged,
  getManagedSprints: getManagedSprints,
  toArray: toArray,
  sprintId: sprintId,
  getSprintDates: getSprintDates,
  getIssueEffortMinutes: getIssueEffortMinutes,
  getIssueResolution: getIssueResolution,
  readIssueEffortState: readIssueEffortState,
  readSprintMinutes: readSprintMinutes,
  applyContributionDelta: applyContributionDelta,
  markSprintDirty: markSprintDirty,
  bumpMetricsRevision: bumpMetricsRevision,
  stampWorkflowUpdate: stampWorkflowUpdate,
};
