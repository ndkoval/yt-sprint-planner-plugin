import React, { useEffect, useRef, useState } from 'react';
import type { IssueView } from '../../shared/api';
import { formatDaysValue } from '../../shared/units';

/** One assignable lane (a teammate) with their available capacity for the Sprint. */
export interface Lane {
  userId: string;
  name: string;
  availableMinutes: number;
}

export interface SprintPlanningBoardProps {
  /** Issues currently in the Sprint. */
  sprintIssues: IssueView[];
  /** Backlog pool (configured search, not yet in the Sprint). */
  backlogIssues: IssueView[];
  lanes: Lane[];
  /** Sprint-level planned capacity (raw × focus factor), for the "what fits" overview. */
  plannedCapacityMinutes: number;
  hoursPerDay: number;
  isManager: boolean;
  /** Whether a backlog search is configured (controls the empty-state copy). */
  backlogConfigured: boolean;
  busyIssueIds: ReadonlySet<string>;
  /** Plan an issue: pull into/out of the Sprint and set assignee. */
  onPlan(issueId: string, target: { inSprint: boolean; assigneeId: string | null }): void;
  /** Open an issue (double-click a card) — the tab opens it in YouTrack's native issue view. */
  onOpenIssue(issue: IssueView): void;
}

const BACKLOG = '__backlog__';
const UNASSIGNED = '__unassigned__';

function effortOf(issue: IssueView): number {
  return issue.originalEffortMinutes ?? 0;
}

const errorColor = 'var(--ring-error-color, #c0341d)';
const successColor = 'var(--ring-success-color, #1a936f)';
const warnColor = 'var(--ring-warning-color, #e08c1c)';
const mainColor = 'var(--ring-main-color, #1f8dd6)';

/**
 * Drag-and-drop capacity planning board. Issues start in the **Backlog** lane (a configured
 * search) and are dragged onto a teammate to pull them into the Sprint AND assign them in one
 * move, or onto **Unassigned** to add them without an owner; drag back to the backlog to
 * remove from the Sprint. Each teammate lane is a capacity **timeline** — a track sized to
 * their available days with committed work filling it — so you can see how the issues fit and
 * who is over. A Sprint-level bar flags when total committed work (including anything still
 * unassigned) exceeds planned capacity, even when no single person is over.
 *
 * Dragging uses pointer events with a visible floating "ghost" of the card that follows the
 * cursor (rather than the browser's native HTML5 drag image), so the motion reads clearly and
 * works with mouse and touch alike.
 */
export function SprintPlanningBoard({
  sprintIssues,
  backlogIssues,
  lanes,
  plannedCapacityMinutes,
  hoursPerDay,
  isManager,
  backlogConfigured,
  busyIssueIds,
  onPlan,
  onOpenIssue,
}: SprintPlanningBoardProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string; days: string } | null>(null);
  const [backlogFilter, setBacklogFilter] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  // A 1×1 transparent image used to hide the browser's native drag image (we render our own
  // floating ghost instead). Created once on mount.
  const dragImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image(1, 1);
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    dragImgRef.current = img;
  }, []);

  const days = (m: number): string => formatDaysValue(m, hoursPerDay);

  const filterQuery = backlogFilter.trim().toLowerCase();
  const filteredBacklog =
    filterQuery.length === 0
      ? backlogIssues
      : backlogIssues.filter((i) =>
          `${i.idReadable} ${i.summary}`.toLowerCase().includes(filterQuery),
        );

  // Group the Sprint's issues by lane; the backlog is its own pool.
  const byLane = new Map<string, IssueView[]>();
  byLane.set(UNASSIGNED, []);
  for (const lane of lanes) byLane.set(lane.userId, []);
  for (const issue of sprintIssues) {
    const key = issue.assigneeId ?? UNASSIGNED;
    if (!byLane.has(key)) byLane.set(key, []); // assignee not on the team → its own lane
    byLane.get(key)!.push(issue);
  }
  const laneOf = new Map<string, string>();
  for (const i of backlogIssues) laneOf.set(i.id, BACKLOG);
  for (const i of sprintIssues) laneOf.set(i.id, i.assigneeId ?? UNASSIGNED);

  const committedFor = (key: string): number =>
    (byLane.get(key) ?? []).reduce((sum, i) => sum + effortOf(i), 0);

  const totalCommitted = sprintIssues.reduce((sum, i) => sum + effortOf(i), 0);
  const unassignedCommitted = committedFor(UNASSIGNED);
  const sprintOver = totalCommitted > plannedCapacityMinutes && plannedCapacityMinutes >= 0;

  const applyDrop = (issueId: string, laneKey: string): void => {
    if ((laneOf.get(issueId) ?? '') === laneKey) return; // dropped where it already is
    if (laneKey === BACKLOG) onPlan(issueId, { inSprint: false, assigneeId: null });
    else if (laneKey === UNASSIGNED) onPlan(issueId, { inSprint: true, assigneeId: null });
    else onPlan(issueId, { inSprint: true, assigneeId: laneKey });
  };

  // Drag-and-drop uses the native HTML5 API — reliable regardless of the widget iframe's height
  // or scroll position — plus a floating "ghost" of the card that follows the cursor via the
  // `drag` event (the native drag image is hidden with a transparent one) so the motion reads
  // clearly. Double-click is separate (opens the issue).
  const beginDrag = (e: React.DragEvent, issue: IssueView): void => {
    if (!isManager || busyIssueIds.has(issue.id)) return;
    e.dataTransfer.setData('text/scp-issue', issue.id);
    e.dataTransfer.effectAllowed = 'move';
    if (dragImgRef.current !== null) e.dataTransfer.setDragImage(dragImgRef.current, 0, 0);
    setDraggingId(issue.id);
    const noEstimate = issue.originalEffortMinutes === null;
    setGhost({
      x: e.clientX,
      y: e.clientY,
      label: `${issue.idReadable} · ${issue.summary || '(no summary)'}`,
      days: noEstimate ? '?' : `${days(effortOf(issue))}d`,
    });
  };
  const moveGhost = (e: React.DragEvent): void => {
    if (e.clientX === 0 && e.clientY === 0) return; // ignore the terminal (drop) drag event
    setGhost((g) => (g === null ? g : { ...g, x: e.clientX, y: e.clientY }));
  };
  const endDrag = (): void => {
    setDraggingId(null);
    setGhost(null);
    setDragOver(null);
  };
  const overLane = (e: React.DragEvent, laneKey: string): void => {
    if (!isManager) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(laneKey);
  };
  const dropOnLane = (e: React.DragEvent, laneKey: string): void => {
    if (!isManager) return;
    e.preventDefault();
    const issueId = e.dataTransfer.getData('text/scp-issue');
    endDrag();
    if (issueId.length > 0) applyDrop(issueId, laneKey);
  };

  const laneMeta = (key: string): { name: string; available: number | null } => {
    if (key === UNASSIGNED) return { name: 'Unassigned · in sprint', available: null };
    const lane = lanes.find((l) => l.userId === key);
    if (lane) return { name: lane.name, available: lane.availableMinutes };
    const anyIssue = (byLane.get(key) ?? [])[0];
    return { name: anyIssue?.assigneeName ?? key, available: null };
  };

  const sprintLaneKeys = [UNASSIGNED, ...lanes.map((l) => l.userId)];
  for (const key of byLane.keys()) if (!sprintLaneKeys.includes(key)) sprintLaneKeys.push(key);

  const cardStyle = (issue: IssueView, noEstimate: boolean): React.CSSProperties => {
    const busy = busyIssueIds.has(issue.id);
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      maxWidth: 260,
      padding: '4px 8px',
      borderRadius: 'var(--ring-border-radius)',
      border: `1px solid ${noEstimate ? warnColor : 'var(--ring-line-color)'}`,
      background: 'var(--ring-secondary-background-color, #f7f9fa)',
      cursor: isManager ? 'grab' : 'default',
      touchAction: isManager ? 'none' : 'auto',
      // Prevent the browser's text-selection from hijacking a drag (it otherwise selects the
      // card's text on press-and-move instead of dragging the card).
      userSelect: 'none',
      WebkitUserSelect: 'none',
      opacity: busy || draggingId === issue.id ? 0.5 : issue.resolved ? 0.6 : 1,
      font: 'var(--ring-font-smaller)',
    };
  };

  const chip = (issue: IssueView): React.JSX.Element => {
    const noEstimate = issue.originalEffortMinutes === null;
    return (
      <div
        key={issue.id}
        draggable={isManager && !busyIssueIds.has(issue.id)}
        onDragStart={(e) => beginDrag(e, issue)}
        onDrag={moveGhost}
        onDragEnd={endDrag}
        onDoubleClick={() => onOpenIssue(issue)}
        title={`${issue.idReadable} ${issue.summary} — double-click to open`}
        style={cardStyle(issue, noEstimate)}
      >
        <span style={{ color: 'var(--ring-secondary-color)' }}>{issue.idReadable}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
          {issue.summary || '(no summary)'}
        </span>
        <span style={{ color: noEstimate ? warnColor : 'var(--ring-secondary-color)', fontWeight: 'bold' }}>
          {noEstimate ? '?' : `${days(effortOf(issue))}d`}
        </span>
      </div>
    );
  };

  // Backlog issues render as full-width rows (a scrollable, searchable list — like an agile
  // board's backlog), rather than the compact chips used inside capacity lanes.
  const backlogRow = (issue: IssueView): React.JSX.Element => {
    const noEstimate = issue.originalEffortMinutes === null;
    return (
      <div
        key={issue.id}
        draggable={isManager && !busyIssueIds.has(issue.id)}
        onDragStart={(e) => beginDrag(e, issue)}
        onDrag={moveGhost}
        onDragEnd={endDrag}
        onDoubleClick={() => onOpenIssue(issue)}
        title={`${issue.idReadable} ${issue.summary} — double-click to open`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 8px',
          borderRadius: 'var(--ring-border-radius)',
          border: `1px solid ${noEstimate ? warnColor : 'var(--ring-line-color)'}`,
          background: 'var(--ring-secondary-background-color, #f7f9fa)',
          cursor: isManager ? 'grab' : 'default',
          touchAction: isManager ? 'none' : 'auto',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          opacity: busyIssueIds.has(issue.id) || draggingId === issue.id ? 0.5 : 1,
          font: 'var(--ring-font-smaller)',
        }}
      >
        <span style={{ color: 'var(--ring-secondary-color)', minWidth: 64 }}>{issue.idReadable}</span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {issue.summary || '(no summary)'}
        </span>
        <span style={{ color: noEstimate ? warnColor : 'var(--ring-secondary-color)', fontWeight: 'bold' }}>
          {noEstimate ? '?' : `${days(effortOf(issue))}d`}
        </span>
      </div>
    );
  };

  const laneShell = (
    key: string,
    header: React.ReactNode,
    bar: React.ReactNode,
    issues: IssueView[],
    emptyText: string,
    accent?: string,
  ): React.JSX.Element => {
    const active = dragOver === key;
    return (
      <div
        key={key}
        aria-label={`Lane ${laneMeta(key).name}`}
        onDragOver={(e) => overLane(e, key)}
        onDragLeave={() => setDragOver((d) => (d === key ? null : d))}
        onDrop={(e) => dropOnLane(e, key)}
        style={{
          border: `1px solid ${active ? mainColor : accent ?? 'var(--ring-line-color)'}`,
          background: active ? 'rgba(31,141,214,0.06)' : 'var(--ring-content-background-color, #fff)',
          borderRadius: 'var(--ring-border-radius)',
          padding: 'calc(var(--ring-unit) * 1.5)',
        }}
      >
        {header}
        {bar}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--ring-unit) * 0.75)', minHeight: 20 }}>
          {issues.length === 0 ? (
            <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
              {emptyText}
            </span>
          ) : (
            issues.map(chip)
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      {/* Floating drag ghost — follows the cursor so the drag is clearly visible. */}
      {ghost !== null ? (
        <div
          style={{
            position: 'fixed',
            left: ghost.x + 14,
            top: ghost.y + 14,
            zIndex: 2147483647,
            pointerEvents: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 260,
            padding: '4px 8px',
            borderRadius: 'var(--ring-border-radius)',
            border: `1px solid ${mainColor}`,
            background: 'var(--ring-content-background-color, #fff)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
            font: 'var(--ring-font-smaller)',
            transform: 'rotate(-2deg)',
          }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>
            {ghost.label}
          </span>
          <span style={{ color: 'var(--ring-secondary-color)', fontWeight: 'bold' }}>{ghost.days}</span>
        </div>
      ) : null}

      {/* Sprint-level "what fits" overview. */}
      <div
        style={{
          padding: 'calc(var(--ring-unit) * 1.5)',
          borderRadius: 'var(--ring-border-radius)',
          marginBottom: 'calc(var(--ring-unit) * 2)',
          background: sprintOver ? 'rgba(192,52,29,0.08)' : 'rgba(26,147,111,0.08)',
          border: `1px solid ${sprintOver ? errorColor : successColor}`,
        }}
      >
        <strong style={{ color: sprintOver ? errorColor : successColor }}>
          {sprintOver
            ? `Over planned capacity by ${days(totalCommitted - plannedCapacityMinutes)}d`
            : `Fits — ${days(plannedCapacityMinutes - totalCommitted)}d of headroom`}
        </strong>
        <span style={{ color: 'var(--ring-secondary-color)', marginLeft: 8 }}>
          {days(totalCommitted)}d committed of {days(plannedCapacityMinutes)}d planned
          {unassignedCommitted > 0 ? ` · ${days(unassignedCommitted)}d unassigned` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ring-unit)' }}>
        {/* Backlog lane — a scrollable, searchable list you pull issues from into the Sprint. */}
        {backlogConfigured ? (
          <div
            aria-label="Lane Backlog"
            onDragOver={(e) => overLane(e, BACKLOG)}
            onDragLeave={() => setDragOver((d) => (d === BACKLOG ? null : d))}
            onDrop={(e) => dropOnLane(e, BACKLOG)}
            style={{
              border: `1px solid ${dragOver === BACKLOG ? mainColor : warnColor}`,
              background: dragOver === BACKLOG ? 'rgba(31,141,214,0.06)' : 'var(--ring-content-background-color, #fff)',
              borderRadius: 'var(--ring-border-radius)',
              padding: 'calc(var(--ring-unit) * 1.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'calc(var(--ring-unit) * 0.75)' }}>
              <strong>Backlog · not in sprint</strong>
              <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
                {filteredBacklog.length} of {backlogIssues.length}
              </span>
            </div>
            <input
              type="search"
              value={backlogFilter}
              placeholder="Search the backlog…"
              onChange={(e) => setBacklogFilter(e.target.value)}
              aria-label="Search the backlog"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: 'calc(var(--ring-unit))',
                padding: '5px 8px',
                border: '1px solid var(--ring-line-color)',
                borderRadius: 'var(--ring-border-radius)',
                font: 'var(--ring-font-smaller)',
              }}
            />
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredBacklog.length === 0 ? (
                <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
                  {backlogIssues.length === 0
                    ? isManager
                      ? 'Backlog is empty — nothing to pull in.'
                      : 'Backlog is empty.'
                    : 'No matching issues.'}
                </span>
              ) : (
                filteredBacklog.map(backlogRow)
              )}
            </div>
          </div>
        ) : null}

        {/* Sprint lanes. */}
        {sprintLaneKeys.map((key) => {
          const { name, available } = laneMeta(key);
          const committed = committedFor(key);
          const over = available !== null && committed > available;
          const pct = available && available > 0 ? Math.min(100, (committed / available) * 100) : 0;
          const header = (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'calc(var(--ring-unit) * 0.75)' }}>
              <strong>{name}</strong>
              <span style={{ font: 'var(--ring-font-smaller)', color: over ? errorColor : 'var(--ring-secondary-color)' }}>
                {available !== null
                  ? `${days(committed)} / ${days(available)}d${over ? ' · over' : ` · ${days(available - committed)}d left`}`
                  : `${days(committed)}d`}
              </span>
            </div>
          );
          const bar =
            available !== null ? (
              <div
                style={{
                  height: 10,
                  borderRadius: 5,
                  background: 'var(--ring-line-color, #e6e6e6)',
                  overflow: 'hidden',
                  marginBottom: 'calc(var(--ring-unit))',
                }}
                role="img"
                aria-label={`${name}: ${days(committed)} of ${days(available)} days committed`}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: over ? errorColor : successColor }} />
              </div>
            ) : null;
          return laneShell(key, header, bar, byLane.get(key) ?? [], isManager ? 'Drop issues here' : 'No issues');
        })}
      </div>
      {isManager ? (
        <p style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)', marginTop: 'calc(var(--ring-unit))' }}>
          Drag an issue from the backlog onto a teammate to pull it into the Sprint and assign it;
          drag it back to the backlog to remove it. Double-click any issue to open it.
        </p>
      ) : null}
    </div>
  );
}
