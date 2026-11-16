import type { PaneDescriptor } from '../contracts';
import { validPose } from '../pose-validation';
import { legacyPoseToWorld, type SavedUIPose } from '../stores/ui-poses';

export interface SavedOpenView {
  paneId: string;
  workspaceId: string;
  sessionId: string;
  windowId: string;
  title?: string;
  pose?: SavedUIPose;
}

export interface OpenViewsProfile {
  views: SavedOpenView[];
  selectedId: string | null;
}

const VERSION = 2;
/** Open-view poses were saved from farther layouts than widget poses, so they allow 100 m. */
const MAX_VIEW_POSE_DISTANCE = 100;
const KEY_PREFIX = 'mux-xr:open-views:v2:';
const LEGACY_KEY_PREFIX = 'mux-xr:open-views:v1:';

function validView(value: unknown): value is SavedOpenView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedOpenView>;
  return (
    typeof candidate.paneId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.windowId === 'string' &&
    (candidate.title === undefined || typeof candidate.title === 'string') &&
    (candidate.pose === undefined || validPose(candidate.pose, MAX_VIEW_POSE_DISTANCE))
  );
}

function cloneView(view: SavedOpenView): SavedOpenView {
  return {
    paneId: view.paneId,
    workspaceId: view.workspaceId,
    sessionId: view.sessionId,
    windowId: view.windowId,
    ...(view.title === undefined ? {} : { title: view.title }),
    ...(view.pose
      ? {
          pose: {
            position: [...view.pose.position] as SavedUIPose['position'],
            quaternion: [...view.pose.quaternion] as SavedUIPose['quaternion'],
            scale: view.pose.scale,
          },
        }
      : {}),
  };
}

function storageKey(serverKey: string, prefix = KEY_PREFIX): string {
  return `${prefix}${encodeURIComponent(serverKey)}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createOpenViewsStore(storage: Storage | null = defaultStorage()): {
  read(serverKey: string): OpenViewsProfile | null;
  save(serverKey: string, profile: OpenViewsProfile): boolean;
} {
  return {
    read(serverKey) {
      if (!storage) return null;
      try {
        const current = storage.getItem(storageKey(serverKey));
        const raw = current ?? storage.getItem(storageKey(serverKey, LEGACY_KEY_PREFIX));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const candidate = parsed as Partial<OpenViewsProfile> & { version?: unknown };
        if (candidate.version !== (current ? VERSION : 1) || !Array.isArray(candidate.views))
          return null;
        if (!(candidate.selectedId === null || typeof candidate.selectedId === 'string'))
          return null;
        if (!candidate.views.every(validView)) return null;
        const views = candidate.views.map(cloneView);
        if (!current)
          for (const view of views) if (view.pose) view.pose = legacyPoseToWorld(view.pose);
        return { views, selectedId: candidate.selectedId };
      } catch {
        return null;
      }
    },
    save(serverKey, profile) {
      if (!storage || !Array.isArray(profile.views) || !profile.views.every(validView))
        return false;
      if (!(profile.selectedId === null || typeof profile.selectedId === 'string')) return false;
      try {
        storage.setItem(
          storageKey(serverKey),
          JSON.stringify({
            version: VERSION,
            views: profile.views.map(cloneView),
            selectedId: profile.selectedId,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function normalizeOpenViewsServer(endpoint: string): string {
  const url = new URL(
    endpoint,
    typeof location === 'undefined' ? 'http://localhost/' : location.href,
  );
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
    throw new Error('Use an HTTP or WebSocket streamer endpoint.');
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/ws')) url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  return `${url.origin}${url.pathname}`;
}

export function resolveOpenViews(
  profile: OpenViewsProfile,
  panes: PaneDescriptor[],
): { views: SavedOpenView[]; missing: SavedOpenView[]; selectedId: string | null } {
  const views: SavedOpenView[] = [];
  const missing: SavedOpenView[] = [];
  for (const view of profile.views) {
    const pane = panes.find(
      (candidate) =>
        candidate.id === view.paneId &&
        candidate.workspaceId === view.workspaceId &&
        candidate.sessionId === view.sessionId &&
        candidate.windowId === view.windowId,
    );
    (pane ? views : missing).push(cloneView(view));
  }
  return {
    views,
    missing,
    selectedId: views.some((view) => view.paneId === profile.selectedId)
      ? profile.selectedId
      : null,
  };
}
