import React, { useCallback, useEffect, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import Select from '@jetbrains/ring-ui-built/components/select/select';
import type { ApiClient } from '../api-client';
import type { IssueView } from '../../shared/api';

export interface IssueTeammate {
  userId: string;
  login: string;
  name: string;
  /** The team the person belongs to (shown as the option's description); optional. */
  team?: string | undefined;
}

export interface IssueDetailsOverlayProps {
  issue: IssueView;
  client: ApiClient;
  /**
   * Assignee dropdown candidates — members of ALL the project's teams (team names
   * shown as descriptions), so handing an issue to another team is possible right
   * here. Shared members are listed once.
   */
  teammates: IssueTeammate[];
  /** Hours in one capacity day, for editing period effort fields in days. */
  hoursPerDay: number;
  /**
   * Document-Y of the card that was double-clicked. The overlay anchors next to it
   * (the widget iframe is very tall — a viewport-centered panel could open far away
   * from where the user is looking).
   */
  anchorY?: number;
  onClose(): void;
  /** Called after a save so the planner can refresh its metrics. */
  onChanged?(): void;
}

interface YtValue {
  id?: string;
  name?: string;
  login?: string;
  fullName?: string;
  presentation?: string;
  minutes?: number;
  text?: string;
}
interface YtField {
  $type?: string;
  name: string;
  value: YtValue | YtValue[] | null;
  projectCustomField?: { bundle?: { values?: YtValue[] } };
}
interface YtComment {
  id: string;
  text?: string;
  author?: { name?: string };
  created?: number;
}
interface YtIssueFull {
  idReadable: string;
  summary: string;
  description: string | null;
  project?: { name?: string };
  reporter?: { name?: string };
  updater?: { name?: string };
  created?: number;
  updated?: number;
  comments?: YtComment[];
  customFields?: YtField[];
}

const LINK = 'var(--ring-link-color, #1f8feb)';
const SECONDARY = 'var(--ring-secondary-color, #737577)';
const LINE = 'var(--ring-line-color, #dfe0e1)';

const ISSUE_FIELDS =
  'idReadable,summary,description,created,updated,reporter(name),updater(name),' +
  'project(name),' +
  'customFields(name,$type,value(id,name,login,fullName,presentation,minutes,text),' +
  'projectCustomField(bundle(values(name))))';
const ACTIVITY_FIELDS =
  'id,$type,timestamp,author(name),field(presentation),' +
  'added(name,text,presentation,fullName),removed(name,text,presentation,fullName)';
const ACTIVITY_CATEGORIES =
  'CommentsCategory,CustomFieldCategory,SummaryCategory,DescriptionCategory,TagsCategory,SprintCategory';

interface YtActivity {
  id: string;
  $type?: string;
  timestamp?: number;
  author?: { name?: string };
  field?: { presentation?: string };
  added?: unknown;
  removed?: unknown;
}

// A small, deterministic palette so enum chips / avatars get a stable colour (like YouTrack's).
const CHIP_COLORS = ['#59a869', '#e8a33d', '#8f7ee7', '#4d9bf0', '#d05f5f', '#3aa0a0', '#c2679a'];
function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length]!;
}
function isPeriod($type?: string): boolean {
  return /Period/.test($type ?? '');
}
function valueText(v: YtValue | YtValue[] | null): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => valueText(x)).join(', ') : '—';
  return v.name ?? v.fullName ?? v.login ?? v.presentation ?? v.text ?? '—';
}
function fmtDate(ms?: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const day = 86_400_000;
  const d = Math.floor(diff / day);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo > 1 ? 's' : ''} ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} year${yr > 1 ? 's' : ''} ago`;
}
// Field-family colours to echo native YouTrack chips (Priority green, Type orange, State blue).
function chipColor(fieldName: string, value: string): string {
  const n = fieldName.toLowerCase();
  if (n.includes('priority')) return '#59a869';
  if (n.includes('type')) return '#e8a33d';
  if (n.includes('state')) return '#7e8ee0';
  return colorFor(value);
}
function daysText(minutes: number | undefined, hoursPerDay: number): string {
  if (minutes === undefined || minutes === null) return '';
  return String(Math.round((minutes / (hoursPerDay * 60)) * 100) / 100);
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * In-page issue editor styled to read like YouTrack's own issue view. Double-clicking
 * a board card opens this as a WIDE panel anchored right where the card is, over a
 * dimmed backdrop that spans the whole widget — never a new tab (though the issue id
 * in the header IS a link that opens the native issue view in one). YouTrack blocks
 * embedding its native issue page in the widget's opaque-origin iframe, so this is
 * the app's own editor driven through the YouTrack REST API in the CURRENT USER's
 * context (`host.fetchYouTrack`) — the user's real permissions apply. Edits the
 * title, description, comments, assignee, effort and enum fields (field values use
 * Ring UI inline selects, like native YouTrack). Escape or the backdrop closes it.
 */
export function IssueDetailsOverlay({
  issue,
  client,
  teammates,
  hoursPerDay,
  anchorY,
  onClose,
  onChanged,
}: IssueDetailsOverlayProps): React.JSX.Element {
  const id = issue.idReadable;
  const [data, setData] = useState<YtIssueFull | null>(null);
  const [activities, setActivities] = useState<YtActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(issue.summary);
  const [desc, setDesc] = useState('');
  const [comment, setComment] = useState('');
  const [effortDrafts, setEffortDrafts] = useState<Record<string, string>>({});

  const yt = useCallback(
    (path: string, method = 'GET', body?: unknown): Promise<unknown> =>
      client.fetchYouTrack(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    [client],
  );

  const reload = useCallback(async (): Promise<void> => {
    const full = (await yt(`issues/${encodeURIComponent(id)}?fields=${ISSUE_FIELDS}`)) as YtIssueFull;
    setData(full);
    setTitle(full.summary ?? '');
    setDesc(full.description ?? '');
    setEffortDrafts({});
    const acts = (await yt(
      `issues/${encodeURIComponent(id)}/activities?categories=${ACTIVITY_CATEGORIES}&fields=${ACTIVITY_FIELDS}&$top=60`,
    ).catch(() => [])) as YtActivity[];
    setActivities(Array.isArray(acts) ? acts : []);
  }, [yt, id]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Escape closes (Ring UI convention) — the backdrop click does too. When a Ring
  // popup (an open inline select) is on screen, Escape belongs to IT: close only
  // the topmost layer. Capture phase: we must observe the popup BEFORE Ring's own
  // handler unmounts it, or both layers close on one keypress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-test~="ring-popup"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await reload();
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, onChanged],
  );

  const patchIssue = (body: unknown): Promise<void> =>
    yt(`issues/${encodeURIComponent(id)}`, 'POST', body).then(() => undefined);
  const setFieldValue = (name: string, $type: string, value: unknown): Promise<void> =>
    run(() => patchIssue({ customFields: [{ name, $type, value }] }));
  const saveTitle = (): Promise<void> =>
    title === (data?.summary ?? '') ? Promise.resolve() : run(() => patchIssue({ summary: title }));
  const saveDesc = (): Promise<void> =>
    desc === (data?.description ?? '') ? Promise.resolve() : run(() => patchIssue({ description: desc }));
  const addComment = (): Promise<void> =>
    run(() =>
      yt(`issues/${encodeURIComponent(id)}/comments`, 'POST', { text: comment }).then(() => setComment('')),
    );
  const openNative = (): void => {
    // The sandboxed iframe blocks top-frame navigation; window.open is the reliable path.
    window.open(`/issue/${encodeURIComponent(id)}`, '_blank', 'noopener');
  };
  const U = 'var(--ring-unit)';
  const fields = data?.customFields ?? [];
  const assigneeType = fields.find((f) => /^assignee$/i.test(f.name))?.$type ?? 'SingleUserIssueCustomField';

  // Anchored WIDE panel over a dimmed backdrop, both inside the widget's (very tall)
  // iframe. Anchoring to the double-clicked card keeps the editor where the user is
  // looking; natural height up to a sane cap avoids a pointless inner scrollbar.
  const panelTop = Math.max(16, (anchorY ?? 16) - 48);
  // Z-order: above the planner content (auto/0) but BELOW Ring UI's overlay layer
  // (--ring-overlay-z-index: 5) — otherwise the inline selects' popups render
  // behind this panel and their options can't be clicked.
  const backdrop: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    background: 'rgba(0, 0, 0, 0.42)',
  };
  const rootPanel: React.CSSProperties = {
    position: 'absolute',
    top: panelTop,
    // Centered WITHOUT a transform: a transformed ancestor becomes the containing
    // block for the inline selects' Ring popups, which then compute document-based
    // coordinates against it and render ~a page away from their anchors.
    left: 'max(24px, calc((100% - 1080px) / 2))',
    width: 'min(1080px, calc(100% - 48px))',
    zIndex: 4,
    boxSizing: 'border-box',
    background: 'var(--ring-content-background-color, #fff)',
    color: 'var(--ring-text-color)',
    border: `1px solid ${LINE}`,
    borderRadius: 8,
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3)',
    padding: `calc(${U} * 3)`,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 240px',
    gridTemplateRows: 'auto max-content',
    alignContent: 'start',
    columnGap: `calc(${U} * 3)`,
    maxHeight: 760,
    overflowY: 'auto',
  };
  const metaText: React.CSSProperties = { fontSize: 13, lineHeight: '20px', color: SECONDARY };
  const bare: React.CSSProperties = {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: 'var(--ring-text-color)',
    padding: 0,
    font: 'inherit',
    boxSizing: 'border-box',
  };

  const chipSquare = (text: string, fieldName: string): React.JSX.Element => (
    <span
      style={{
        flex: 'none',
        width: 22,
        height: 22,
        borderRadius: 4,
        background: chipColor(fieldName, text),
        color: '#fff',
        font: '700 12px/22px sans-serif',
        textAlign: 'center',
      }}
    >
      {text[0]?.toUpperCase() ?? '?'}
    </span>
  );
  const avatar = (name: string, size = 22): React.JSX.Element => (
    <span
      style={{
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorFor(name),
        color: '#fff',
        font: `700 ${Math.round(size * 0.42)}px/${size}px sans-serif`,
        textAlign: 'center',
      }}
    >
      {initials(name)}
    </span>
  );

  // One field block in the native layout: a left column (gray label + value control
  // stacked) and the icon/chip/avatar on the right, vertically centred (as in native).
  const field = (name: string, right: React.ReactNode, value: React.ReactNode): React.JSX.Element => (
    <div
      key={name}
      data-test="scp-field"
      data-field={name}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: U, marginBottom: `calc(${U} * 2.5)` }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: SECONDARY, marginBottom: 2 }}>{name}</div>
        <div>{value}</div>
      </div>
      {right ? <div style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>{right}</div> : null}
    </div>
  );

  // Format an activity's added/removed value (enum arrays, user names, period minutes, comment text).
  const repr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) {
      return v
        .map((x) => {
          const o = x as YtValue;
          return o.name ?? o.fullName ?? o.text ?? o.presentation ?? '';
        })
        .filter(Boolean)
        .join(', ');
    }
    if (typeof v === 'number') return `${Math.round((v / (hoursPerDay * 60)) * 100) / 100}d`;
    if (typeof v === 'object') {
      const o = v as YtValue;
      return o.name ?? o.fullName ?? o.text ?? o.presentation ?? '';
    }
    return String(v);
  };
  const isComment = (a: YtActivity): boolean => /Comment/i.test(a.$type ?? '');
  // Group CONSECUTIVE changes by the same author into one feed entry (like native), newest first.
  const groups: Array<{ key: string; author: string; ts: number; items: YtActivity[] }> = [];
  for (const a of activities) {
    const author = a.author?.name ?? 'Someone';
    const last = groups[groups.length - 1];
    if (last !== undefined && last.author === author) {
      last.items.push(a);
      last.ts = a.timestamp ?? last.ts;
    } else {
      groups.push({ key: a.id ?? `${author}-${a.timestamp ?? 0}`, author, ts: a.timestamp ?? 0, items: [a] });
    }
  }
  groups.reverse();

  // Assignee options: one entry per person (shared members listed once), team names
  // as descriptions. Rendered with a Ring INLINE select so it reads like native YT.
  const assigneeOptions = (() => {
    const byLogin = new Map<string, { key: string; label: string; description?: string }>();
    for (const m of teammates) {
      const existing = byLogin.get(m.login);
      if (existing) {
        if (m.team && existing.description && !existing.description.includes(m.team)) {
          existing.description = `${existing.description}, ${m.team}`;
        }
      } else {
        byLogin.set(m.login, {
          key: m.login,
          label: m.name,
          ...(m.team ? { description: m.team } : {}),
        });
      }
    }
    return [{ key: '', label: 'Unassigned' }, ...byLogin.values()];
  })();

  return (
    <>
      <div data-test="scp-issue-overlay-backdrop" onClick={() => !busy && onClose()} style={backdrop} />
      <div data-test="scp-issue-overlay" role="dialog" aria-label={`Issue ${id}`} style={rootPanel}>
        {/* Header */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: `calc(${U} * 2)` }}>
          <div style={metaText}>
            <div>
              <button
                data-test="scp-issue-overlay-open-native"
                onClick={openNative}
                title={`Open ${id} in a new tab`}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  color: LINK,
                  fontWeight: 500,
                  font: 'inherit',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {id} ↗
              </button>
              {data?.reporter?.name ? (
                <>
                  {'  ·  Created by '}
                  <span style={{ color: LINK }}>{data.reporter.name}</span> {fmtDate(data.created)}
                </>
              ) : null}
            </div>
            {data?.updater?.name ? (
              <div>
                {'Updated by '}
                <span style={{ color: LINK }}>{data.updater.name}</span> {fmtDate(data.updated)}
              </div>
            ) : null}
          </div>
          <button
            data-test="scp-issue-overlay-close"
            aria-label="Close"
            onClick={() => !busy && onClose()}
            style={{ border: 'none', background: 'none', cursor: 'pointer', font: '22px/1 sans-serif', color: SECONDARY, padding: 0, marginLeft: U }}
          >
            ✕
          </button>
        </div>

        {/* Main column */}
        <div style={{ minWidth: 0, paddingRight: `calc(${U} * 3)` }}>
          <input
            aria-label="Issue title"
            style={{ ...bare, font: '600 28px/1.25 var(--ring-font-family, sans-serif)', marginTop: 0 }}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />

          <textarea
            aria-label="Issue description"
            style={{
              ...bare,
              marginTop: `calc(${U} * 2.5)`,
              minHeight: 54,
              resize: 'none',
              fontSize: 15,
              lineHeight: 1.5,
              color: desc ? 'var(--ring-text-color)' : SECONDARY,
            }}
            value={desc}
            disabled={busy}
            placeholder="This issue doesn't have a description yet. To add one, click here."
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => void saveDesc()}
          />

          <div style={{ borderTop: `1px solid ${LINE}`, margin: `calc(${U} * 3) 0 calc(${U} * 2)` }} />

          <div style={{ display: 'flex', gap: U, alignItems: 'flex-start' }}>
            {avatar(client.me.name || client.me.login || 'Me', 28)}
            <div style={{ flex: 1 }}>
              <textarea
                aria-label="Write a comment"
                style={{
                  width: '100%', minHeight: 38, resize: 'vertical', boxSizing: 'border-box',
                  padding: `calc(${U}) calc(${U} * 1.5)`, borderRadius: 'var(--ring-border-radius)',
                  border: `1px solid ${LINE}`, background: 'var(--ring-input-background-color)',
                  color: 'var(--ring-text-color)', font: 'inherit', fontSize: 15,
                }}
                value={comment}
                disabled={busy}
                placeholder="Write a comment, @mention people"
                onChange={(e) => setComment(e.target.value)}
              />
              {comment.trim().length > 0 ? (
                <Button primary loader={busy} onClick={addComment} style={{ marginTop: `calc(${U} / 2)` }}>
                  Comment
                </Button>
              ) : null}
            </div>
          </div>

          {/* Activity feed: comments + field-change history, grouped by author/time (newest first). */}
          {groups.map((g) => (
            <div key={g.key} style={{ display: 'flex', gap: U, marginTop: `calc(${U} * 2.5)` }}>
              {avatar(g.author, 28)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: LINK, fontWeight: 600 }}>{g.author}</span>{' '}
                  <span style={{ color: SECONDARY }}>· {fmtDate(g.ts)}</span>
                </div>
                {g.items.map((a, i) =>
                  isComment(a) ? (
                    <div key={a.id ?? i} style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginTop: 2 }}>
                      {repr(a.added)}
                    </div>
                  ) : (
                    <div key={a.id ?? i} style={{ fontSize: 14, marginTop: 2 }}>
                      <span style={{ color: SECONDARY }}>{a.field?.presentation ?? 'Field'}: </span>
                      {a.removed !== null && a.removed !== undefined && repr(a.removed) ? (
                        <>
                          <span style={{ textDecoration: 'line-through', color: SECONDARY }}>{repr(a.removed)}</span>
                          {' → '}
                        </>
                      ) : null}
                      <span>{repr(a.added)}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <div style={{ minWidth: 0 }}>
          {error !== null ? (
            <div style={{ color: 'var(--ring-error-color)', marginBottom: U }}>{error}</div>
          ) : null}

          {data?.project?.name
            ? field('Project', null, <div style={{ color: LINK, fontSize: 15, fontWeight: 500 }}>{data.project.name}</div>)
            : null}

          {fields.map((f) => {
            const values = f.projectCustomField?.bundle?.values ?? [];
            if (/^assignee$/i.test(f.name)) {
              // Read the CURRENT assignee from the freshly fetched issue (`data`
              // reloads after every save) — the `issue` prop is a snapshot from the
              // moment the overlay opened and would show stale values after edits.
              const assigneeValue = Array.isArray(f.value) ? null : f.value;
              const currentLogin = assigneeValue?.login ?? '';
              const currentName = assigneeValue?.fullName ?? assigneeValue?.name ?? null;
              const selected =
                assigneeOptions.find((o) => o.key === currentLogin) ??
                (currentLogin.length > 0
                  ? { key: currentLogin, label: currentName ?? currentLogin }
                  : assigneeOptions[0]!);
              return field(
                'Assignee',
                currentName ? avatar(currentName) : null,
                <Select
                  type={Select.Type.INLINE}
                  data={assigneeOptions}
                  selected={selected}
                  disabled={busy}
                  onSelect={(item) => {
                    if (item === null) return;
                    const login = String(item.key);
                    void setFieldValue(
                      'Assignee',
                      f.$type ?? assigneeType,
                      login.length > 0 ? { login } : null,
                    );
                  }}
                />,
              );
            }
            if (values.length > 0) {
              const current = Array.isArray(f.value) ? '' : (f.value?.name ?? '');
              const options = values
                .filter((v) => typeof v.name === 'string')
                .map((v) => ({ key: v.name!, label: v.name! }));
              const selected = options.find((o) => o.key === current) ?? null;
              return field(
                f.name,
                current ? chipSquare(current, f.name) : null,
                <Select
                  type={Select.Type.INLINE}
                  data={options}
                  selected={selected}
                  label="—"
                  disabled={busy}
                  onSelect={(item) => {
                    if (item === null) return;
                    void setFieldValue(f.name, f.$type ?? 'SingleEnumIssueCustomField', { name: String(item.key) });
                  }}
                />,
              );
            }
            if (isPeriod(f.$type)) {
              const cur = Array.isArray(f.value) ? undefined : f.value?.minutes;
              const draft = effortDrafts[f.name] ?? daysText(cur, hoursPerDay);
              return field(
                f.name,
                null,
                <input
                  aria-label={f.name}
                  type="text"
                  inputMode="decimal"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: LINK,
                    fontSize: 15,
                    fontWeight: 500,
                    cursor: 'text',
                    padding: 0,
                    width: '100%',
                  }}
                  value={draft}
                  placeholder="? (days)"
                  disabled={busy}
                  onChange={(e) => setEffortDrafts((d) => ({ ...d, [f.name]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.stopPropagation();
                    const t = draft.trim();
                    const n = t === '' ? null : Number(t);
                    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
                    void setFieldValue(f.name, f.$type ?? 'PeriodIssueCustomField', n === null ? null : { minutes: Math.round(n * hoursPerDay * 60) });
                  }}
                />,
              );
            }
            return field(f.name, null, <div style={{ color: LINK, fontSize: 15, fontWeight: 500 }}>{valueText(f.value)}</div>);
          })}
        </div>
      </div>
    </>
  );
}
