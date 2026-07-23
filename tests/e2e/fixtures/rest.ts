/**
 * Minimal admin REST helper for e2e assertions against NATIVE YouTrack state
 * (the app must agree with the real board/sprints/issues, not just its own UI)
 * and against the app backend (per-project config isolation checks).
 * Uses YT_TEST_ADMIN_TOKEN, which scripts/run-e2e.mjs forwards into the run.
 */

const base = (process.env.YT_TEST_BASE_URL ?? '').replace(/\/?$/, '/');
const token = process.env.YT_TEST_ADMIN_TOKEN ?? '';

export const hasAdminRest = base.length > 1 && token.length > 0;

async function call(path: string, query: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(path.replace(/^\//, ''), base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`);
  return res.json();
}

/** The readable id of any issue in a project (for the issue-page entry point). */
export async function firstIssueId(projectKey: string): Promise<string | null> {
  const issues = (await call('api/issues', {
    query: `project: ${projectKey}`,
    fields: 'idReadable',
    $top: '1',
  })) as Array<{ idReadable: string }>;
  return Array.isArray(issues) && issues.length > 0 ? issues[0].idReadable : null;
}

/** Native sprints of a board: [{id, name}]. */
export async function boardSprints(boardId: string): Promise<Array<{ id: string; name: string }>> {
  const s = (await call(`api/agiles/${boardId}/sprints`, { fields: 'id,name', $top: '100' })) as Array<{
    id: string;
    name: string;
  }>;
  return Array.isArray(s) ? s : [];
}

/** Issues currently on a native sprint: [{idReadable, summary, assignee}]. */
export async function sprintIssues(
  boardId: string,
  sprintId: string,
): Promise<Array<{ idReadable: string; summary: string; assignee: string | null }>> {
  const issues = (await call(`api/agiles/${boardId}/sprints/${sprintId}/issues`, {
    fields: 'idReadable,summary,customFields(name,value(login))',
    $top: '200',
  })) as Array<{ idReadable: string; summary: string; customFields?: Array<{ name: string; value?: { login?: string } | null }> }>;
  if (!Array.isArray(issues)) return [];
  return issues.map((i) => ({
    idReadable: i.idReadable,
    summary: i.summary,
    assignee: i.customFields?.find((f) => f.name === 'Assignee')?.value?.login ?? null,
  }));
}

interface RestIssue {
  idReadable: string;
  summary?: string;
  customFields?: Array<{ name: string; value?: { name?: string } | null }>;
}

function enumValueOf(issue: RestIssue | undefined, fieldName: string): string | null {
  const field = issue?.customFields?.find((f) => f.name === fieldName);
  return field?.value?.name ?? null;
}

/** One issue's single-enum custom field value by readable id (null when empty). */
export async function issueEnumField(
  idReadable: string,
  fieldName: string,
): Promise<string | null> {
  const issues = (await call('api/issues', {
    query: idReadable,
    fields: 'idReadable,summary,customFields(name,value(name))',
    $top: '10',
  })) as RestIssue[];
  return enumValueOf(
    Array.isArray(issues) ? issues.find((i) => i.idReadable === idReadable) : undefined,
    fieldName,
  );
}

/**
 * Same, resolved by EXACT summary within a project (seed issue numbers are not
 * stable across reseeds — YouTrack keeps counting after deletes).
 */
export async function issueEnumFieldBySummary(
  projectKey: string,
  summary: string,
  fieldName: string,
): Promise<string | null> {
  const issues = (await call('api/issues', {
    query: `project: ${projectKey}`,
    fields: 'idReadable,summary,customFields(name,value(name))',
    $top: '200',
  })) as RestIssue[];
  return enumValueOf(
    Array.isArray(issues) ? issues.find((i) => i.summary === summary) : undefined,
    fieldName,
  );
}

/** The app backend's config response for a project (admin caller). Config v4: all settings per team. */
export async function appConfig(projectKey: string): Promise<{
  configured: boolean;
  configRevision: number;
  config: {
    version?: number;
    teams?: Array<{
      id: string;
      name: string;
      boardId?: string;
      nameTemplate?: string;
      hoursPerDay?: number;
      sprintLengthDays?: number;
      backlogQuery?: string;
      reminderLeadDays?: number;
    }>;
  } | null;
}> {
  const url = new URL('api/extensionEndpoints/sprint-capacity-planner/backend/config', base);
  url.searchParams.set('project', projectKey);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const envelope = (await res.json()) as { ok: boolean; data?: never; error?: { message: string } };
  if (!envelope.ok) throw new Error(`app config ${projectKey}: ${envelope.error?.message}`);
  return envelope.data as never;
}
