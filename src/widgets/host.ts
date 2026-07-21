/**
 * The single seam between the widgets and the YouTrack host page.
 *
 * `initHost()` performs an EAGER `YTApp.register()` before anything renders — the
 * host contract requires prompt registration, and a widget that defers it (or
 * swallows its failure) surfaces as YouTrack's "Unable to load" error. Every widget
 * entry point awaits this first and renders an explicit error state on failure.
 */

/** RequestInit-like options the host understands (a subset of fetch's). */
export interface HostRequestInit {
  method?: string;
  /** JSON string body (parsed before handing to the host, which stringifies itself). */
  body?: string;
}

interface YouTrackHostApi {
  fetchApp(
    relativeUrl: string,
    options: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<unknown>;
  fetchYouTrack(
    relativeUrl: string,
    options?: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<unknown>;
  enterModalMode?(): void | Promise<void>;
  exitModalMode?(): void | Promise<void>;
}

interface YTAppGlobal {
  register?(): Promise<YouTrackHostApi>;
  // In a project context `entity` is the project; in an issue context it is the issue,
  // which carries its `project`. A dashboard has no entity.
  entity?: { id?: string; shortName?: string; project?: { id?: string; shortName?: string } };
  me?: { id?: string; login?: string; name?: string };
}

interface AppWindow extends Window {
  YTApp?: YTAppGlobal;
}

/** Everything the widgets need from the host, resolved once at startup. */
export interface WidgetHost {
  /** The current viewer (from YTApp.me). */
  me: { login: string; name: string };
  /** The hosting entity (project or issue), when the extension point provides one. */
  entity: YTAppGlobal['entity'];
  /** Call the YouTrack REST API (path relative to /api) as the CURRENT USER. */
  fetchYouTrack(path: string, init?: HostRequestInit): Promise<unknown>;
  /** Call the app's own backend handler (path relative to the app). */
  fetchApp(path: string, options: { method?: string; query?: Record<string, string>; body?: unknown }): Promise<unknown>;
  enterModalMode(): Promise<void>;
  exitModalMode(): Promise<void>;
}

/** Register with the YouTrack host. Throws when not running inside YouTrack. */
export async function initHost(): Promise<WidgetHost> {
  const w = window as AppWindow;
  if (!w.YTApp?.register) {
    throw new Error('This widget must run inside YouTrack (YTApp is not available).');
  }
  const api = await w.YTApp.register();
  const me = w.YTApp.me;
  const login = typeof me?.login === 'string' && me.login.length > 0 ? me.login : '';
  return {
    me: { login, name: me?.name ?? login },
    entity: w.YTApp.entity,
    fetchYouTrack: (path, init) =>
      api.fetchYouTrack(path, {
        method: init?.method ?? 'GET',
        ...(init?.body !== undefined ? { body: JSON.parse(init.body) as unknown } : {}),
      }),
    fetchApp: (path, options) => api.fetchApp(path, options),
    enterModalMode: async () => {
      await api.enterModalMode?.();
    },
    exitModalMode: async () => {
      await api.exitModalMode?.();
    },
  };
}
