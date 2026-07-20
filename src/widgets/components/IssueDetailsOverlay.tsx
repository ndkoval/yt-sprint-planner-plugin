import React, { useCallback, useEffect, useState } from 'react';
import Button from '@jetbrains/ring-ui-built/components/button/button';
import type { ApiClient } from '../api-client';
import type { IssueView } from '../../shared/api';

export interface IssueTeammate {
  userId: string;
  login: string;
  name: string;
}

export interface IssueDetailsOverlayProps {
  issue: IssueView;
  client: ApiClient;
  /** Sprint teammates, for the assignee dropdown. */
  teammates: IssueTeammate[];
  /** Hours in one capacity day, for editing period effort fields in days. */
  hoursPerDay: number;
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
interface YtTag {
  id: string;
  name: string;
}
interface YtIssueFull {
  idReadable: string;
  summary: string;
  description: string | null;
  reporter?: { name?: string };
  updater?: { name?: string };
  created?: number;
  updated?: number;
  tags?: YtTag[];
  comments?: YtComment[];
  customFields?: YtField[];
}

const LINK = 'var(--ring-link-color, #1f8feb)';
const SECONDARY = 'var(--ring-secondary-color, #737577)';
const LINE = 'var(--ring-line-color, #dfe0e1)';

const ISSUE_FIELDS =
  'idReadable,summary,description,created,updated,reporter(name),updater(name),' +
  'tags(id,name),' +
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
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 * In-page issue editor styled to read like YouTrack's own issue slide-over. Double-clicking a
 * board card opens this as a full-page overlay OVER the planner (dimmed behind it —
 * `enterModalMode`), never a new tab/window. YouTrack blocks embedding its native issue page in
 * the widget's opaque-origin iframe, so this is the app's own editor driven through the YouTrack
 * REST API in the CURRENT USER's context (`host.fetchYouTrack`) — the user's real permissions
 * apply. Edits the title, description, comments, tags, assignee, effort and enum fields via
 * direct issue updates (the `/commands` endpoint isn't reachable through the app host).
 */
export function IssueDetailsOverlay({
  issue,
  client,
  teammates,
  hoursPerDay,
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
  const [tagInput, setTagInput] = useState('');
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
    void client.enterModalMode();
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      void client.exitModalMode();
    };
  }, []);

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
  const addTag = (name: string): Promise<void> =>
    run(() => yt(`issues/${encodeURIComponent(id)}/tags`, 'POST', { name }).then(() => setTagInput('')));
  const removeTag = (tagId: string): Promise<void> =>
    run(() =>
      yt(`issues/${encodeURIComponent(id)}/tags/${encodeURIComponent(tagId)}`, 'DELETE').then(() => undefined),
    );

  const U = 'var(--ring-unit)';
  const fields = data?.customFields ?? [];
  const assigneeType = fields.find((f) => /^assignee$/i.test(f.name))?.$type ?? 'SingleUserIssueCustomField';

  // The app host already presents the widget as a fixed ~600px centred modal (it dims the page
  // behind), so we fill that modal edge-to-edge — no extra backdrop or right-aligned inner panel
  // (that caused double-dimming + a cramped centre). A narrow fields column (native proportion)
  // leaves the issue content the larger share.
  const rootPanel: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483000,
    overflow: 'auto',
    boxSizing: 'border-box',
    background: 'var(--ring-content-background-color, #fff)',
    color: 'var(--ring-text-color)',
    padding: `calc(${U} * 3)`,
    display: 'grid',
    gridTemplateColumns: 'minmax(0,1fr) 184px',
    gridTemplateRows: 'auto max-content',
    alignContent: 'start',
    columnGap: `calc(${U} * 3)`,
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
  const valueControl: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: LINK,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    padding: 0,
    width: '100%',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
  };

  const chipSquare = (text: string): React.JSX.Element => (
    <span
      style={{
        flex: 'none',
        width: 22,
        height: 22,
        borderRadius: 4,
        background: colorFor(text),
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

  // One field block in the native "label (gray) · chip (top-right) / value (blue) below" layout.
  const field = (name: string, right: React.ReactNode, value: React.ReactNode): React.JSX.Element => (
    <div key={name} style={{ marginBottom: `calc(${U} * 2.5)` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 22, marginBottom: 2 }}>
        <span style={{ fontSize: 13, color: SECONDARY }}>{name}</span>
        {right}
      </div>
      <div>{value}</div>
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

  return (
    <div data-test="scp-issue-overlay" style={rootPanel}>
      {/* Header */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: `calc(${U} * 2)` }}>
          <div style={metaText}>
            <div>
              <span style={{ color: LINK, fontWeight: 500 }}>{id}</span>
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
            {avatar('Nikita Koval', 28)}
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

          {field(
            'Assignee',
            issue.assigneeName ? avatar(issue.assigneeName) : null,
            <select
              aria-label="Assignee"
              style={valueControl}
              value={issue.assigneeId ?? ''}
              disabled={busy}
              onChange={(e) => void setFieldValue('Assignee', assigneeType, e.target.value ? { id: e.target.value } : null)}
            >
              <option value="">Unassigned</option>
              {teammates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>,
          )}

          {fields.map((f) => {
            if (/^assignee$/i.test(f.name)) return null;
            const values = f.projectCustomField?.bundle?.values ?? [];
            if (values.length > 0) {
              const current = Array.isArray(f.value) ? '' : (f.value?.name ?? '');
              return field(
                f.name,
                current ? chipSquare(current) : null,
                <select
                  aria-label={f.name}
                  style={valueControl}
                  value={current}
                  disabled={busy}
                  onChange={(e) => void setFieldValue(f.name, f.$type ?? 'SingleEnumIssueCustomField', { name: e.target.value })}
                >
                  {current === '' ? <option value="">—</option> : null}
                  {values.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>,
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
                  style={{ ...valueControl, cursor: 'text' }}
                  value={draft}
                  placeholder="? (days)"
                  disabled={busy}
                  onChange={(e) => setEffortDrafts((d) => ({ ...d, [f.name]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
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

          {field(
            'Tags',
            null,
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: `calc(${U} / 2)` }}>
                {(data?.tags ?? []).map((t) => (
                  <span
                    key={t.id}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: `2px ${U}`,
                      borderRadius: 12, background: 'var(--ring-tag-background-color, #eceef0)', fontSize: 13,
                    }}
                  >
                    {t.name}
                    <button
                      aria-label={`Remove tag ${t.name}`}
                      disabled={busy}
                      onClick={() => void removeTag(t.id)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <input
                aria-label="Add tag"
                style={{ ...bare, color: SECONDARY, fontSize: 15, marginTop: (data?.tags?.length ?? 0) > 0 ? `calc(${U} / 2)` : 0 }}
                value={tagInput}
                disabled={busy}
                placeholder="Add a tag, then Enter"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) void addTag(tagInput.trim());
                }}
              />
            </div>,
          )}
        </div>
    </div>
  );
}
