import * as THREE from 'three';
import {
  createDefaultRepoStatusFetcher,
  type RepoCiState,
  type RepoStatusFailure,
  type RepoStatusFetcher,
  type RepoStatusReport,
} from '../host-repo-status';
import { formatAge } from '../workspace/agent-roster';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const REPO_STATUS_KIND = 'repo-status';
/** Matches the server's git cache, so a poll never waits on a stale answer for long. */
export const REPO_STATUS_POLL_MS = 10_000;
export const REPO_STATUS_WIDTH = 0.5;
export const REPO_STATUS_HEIGHT = 0.25;

/** What the widget knows about the focused pane and its repo. */
export type RepoStatusModel =
  | { kind: 'no-pane' }
  | { kind: 'no-cwd' }
  | { kind: 'loading' }
  | { kind: 'failed'; code: RepoStatusFailure }
  | { kind: 'report'; report: RepoStatusReport };

export type RepoBadgeTone = RepoCiState | 'none';

export interface RepoStatusView {
  title: string;
  branch: string;
  detail: string;
  badge: string;
  tone: RepoBadgeTone;
  ciDetail: string;
}

export const REPO_BADGE_COLORS: Record<RepoBadgeTone, number> = {
  success: 0x2f7a5a,
  failure: 0x9a3a36,
  in_progress: 0x8a6a24,
  unknown: 0x3a4a55,
  none: 0x24323c,
};

const BADGE_TEXT: Record<RepoCiState, string> = {
  success: 'CI passed',
  failure: 'CI failed',
  in_progress: 'CI running',
  unknown: 'CI unknown',
};

const FAILURE_TEXT: Record<RepoStatusFailure, string> = {
  'no-secret': 'Pair the host clipboard in Settings',
  disabled: 'Repo status is off on the Mac',
  auth: 'The Mac rejected the pairing secret',
  'rate-limited': 'Too many requests; retrying',
  unavailable: 'Status service unreachable',
  timeout: 'Status service timed out',
};

const quiet = (title: string, branch: string, detail = ''): RepoStatusView => ({
  title,
  branch,
  detail,
  badge: '',
  tone: 'none',
  ciDetail: '',
});

export function formatAheadBehind(report: Extract<RepoStatusReport, { state: 'ok' }>): string {
  const state = report.dirty === null ? 'state unknown' : report.dirty ? 'dirty' : 'clean';
  if (!report.upstream) return `${state} · no upstream`;
  if (!report.ahead && !report.behind) return `${state} · in sync`;
  return `${state} · ${report.ahead} ahead · ${report.behind} behind`;
}

export function repoStatusView(model: RepoStatusModel, nowMs: number): RepoStatusView {
  switch (model.kind) {
    case 'no-pane':
      return quiet('Git & CI', 'No pane focused');
    case 'no-cwd':
      return quiet('Git & CI', 'Directory unknown', 'The shell does not report its cwd');
    case 'loading':
      return quiet('Git & CI', 'Checking…');
    case 'failed':
      return quiet('Git & CI', 'Unavailable', FAILURE_TEXT[model.code]);
  }
  const { report } = model;
  if (report.state === 'not-a-repo') return quiet('Git & CI', 'Not a git repository');
  if (report.state === 'remote')
    return quiet('Git & CI', 'Remote shell', 'The pane is on another host');
  if (report.state === 'unavailable')
    return quiet('Git & CI', 'Unavailable', 'git could not read the repo');
  const ci = report.ci;
  const created = ci?.createdAt ? Date.parse(ci.createdAt) : Number.NaN;
  const age = Number.isFinite(created) ? formatAge(created, nowMs) : '';
  return {
    title: report.repo,
    branch: report.detached ? 'detached HEAD' : (report.branch ?? 'no branch'),
    detail: formatAheadBehind(report),
    badge: ci ? BADGE_TEXT[ci.state] : 'CI unavailable',
    tone: ci ? ci.state : 'none',
    ciDetail: ci
      ? [ci.workflow, age && `${age} ago`].filter(Boolean).join(' · ')
      : report.detached
        ? 'detached HEAD has no runs'
        : 'gh has no data for this repo',
  };
}

export interface RepoStatusWidgetOptions {
  fetchStatus?: RepoStatusFetcher;
  pollMs?: number;
  /** Whether the page is hidden; polling pauses while it is. */
  pageHidden?: () => boolean;
}

let nextRepoStatusId = 1;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const PAD = 0.025;
const TOP = REPO_STATUS_HEIGHT / 2;
const LEFT = -REPO_STATUS_WIDTH / 2 + PAD;
const TEXT_WIDTH = REPO_STATUS_WIDTH - PAD * 2;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function shownInScene(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent)
    if (!current.visible || current.userData.focusHidden) return false;
  return true;
}

const defaultPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createRepoStatusWidget(
  envMap: THREE.Texture | null = null,
  options: RepoStatusWidgetOptions = {},
): Widget {
  const widgetId = `${REPO_STATUS_KIND}-${nextRepoStatusId++}`;
  let fetchStatus = options.fetchStatus;
  const pollMs = options.pollMs ?? REPO_STATUS_POLL_MS;
  const pageHidden = options.pageHidden ?? defaultPageHidden;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(REPO_STATUS_WIDTH, REPO_STATUS_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'repo-status-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(REPO_STATUS_WIDTH - 0.035, REPO_STATUS_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'repo-status-face';
  face.position.z = 0.014;
  root.add(body, face);

  const line = (name: string, y: number, height: number, width = TEXT_WIDTH): THREE.Mesh => {
    const label = createScalableLabel('', width, height, { backplate: false, align: 'left' });
    label.name = name;
    label.position.set(LEFT + width / 2, y, 0.03);
    root.add(label);
    return label;
  };
  const title = line('repo-status-title', TOP - 0.04, 0.045, TEXT_WIDTH - 0.06);
  const branch = line('repo-status-branch', TOP - 0.088, 0.04);
  const detail = line('repo-status-detail', TOP - 0.13, 0.034);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'repo-status-close';
  close.position.set(REPO_STATUS_WIDTH / 2 - 0.04, TOP - 0.04, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the git and CI status';
  root.add(close);

  const BADGE_WIDTH = 0.15;
  const BADGE_HEIGHT = 0.045;
  const BADGE_Y = -TOP + PAD + BADGE_HEIGHT / 2 + 0.005;
  const badgeMaterial = new THREE.MeshBasicMaterial({ color: REPO_BADGE_COLORS.none });
  const badgePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(BADGE_WIDTH, BADGE_HEIGHT),
    badgeMaterial,
  );
  badgePlate.name = 'repo-status-badge-plate';
  badgePlate.position.set(LEFT + BADGE_WIDTH / 2, BADGE_Y, 0.028);
  root.add(badgePlate);
  const badge = createScalableLabel('', BADGE_WIDTH, BADGE_HEIGHT * 0.8, { backplate: false });
  badge.name = 'repo-status-badge';
  badge.position.set(LEFT + BADGE_WIDTH / 2, BADGE_Y, 0.032);
  root.add(badge);
  const CI_WIDTH = TEXT_WIDTH - BADGE_WIDTH - 0.015;
  const ciDetail = createScalableLabel('', CI_WIDTH, 0.032, { backplate: false, align: 'left' });
  ciDetail.name = 'repo-status-ci-detail';
  ciDetail.position.set(REPO_STATUS_WIDTH / 2 - PAD - CI_WIDTH / 2, BADGE_Y, 0.03);
  root.add(ciDetail);

  const toneColors = Object.fromEntries(
    Object.entries(REPO_BADGE_COLORS).map(([key, hex]) => [key, new THREE.Color(hex)]),
  ) as Record<RepoBadgeTone, THREE.Color>;

  let disposed = false;
  let model: RepoStatusModel = { kind: 'no-pane' };
  let paneId: string | null = null;
  let cwd: string | null = null;
  let host: string | null = null;
  let generation = 0;
  let inFlight = false;
  let lastPollAt = Number.NEGATIVE_INFINITY;
  let lastRenderSecond = -1;

  const render = (nowMs: number): void => {
    const view = repoStatusView(model, nowMs);
    setText(title, view.title);
    setText(branch, view.branch);
    setText(detail, view.detail);
    badgePlate.visible = view.tone !== 'none' || view.badge !== '';
    badge.visible = view.badge !== '';
    setText(badge, view.badge);
    badgeMaterial.color.copy(toneColors[view.tone]);
    setText(ciDetail, view.ciDetail);
    lastRenderSecond = Math.floor(nowMs / 1000);
  };

  const poll = (nowMs: number): void => {
    if (!cwd || inFlight || disposed) return;
    fetchStatus ??= createDefaultRepoStatusFetcher();
    const token = generation;
    inFlight = true;
    lastPollAt = nowMs;
    void fetchStatus(cwd, host)
      .catch(() => ({ ok: false as const, code: 'unavailable' as const }))
      .then((result) => {
        if (token !== generation) return;
        inFlight = false;
        if (disposed) return;
        model = result.ok
          ? { kind: 'report', report: result.report }
          : { kind: 'failed', code: result.code };
        render(Date.now());
      });
  };

  const setFocusedPane = (
    nextPaneId: string | null,
    nextCwd: string | null,
    nextHost: string | null = null,
  ): void => {
    if (disposed || (nextPaneId === paneId && nextCwd === cwd && nextHost === host)) return;
    host = nextHost;
    paneId = nextPaneId;
    cwd = nextPaneId ? nextCwd : null;
    generation += 1;
    inFlight = false;
    model = !paneId ? { kind: 'no-pane' } : !cwd ? { kind: 'no-cwd' } : { kind: 'loading' };
    lastPollAt = Number.NEGATIVE_INFINITY;
    const nowMs = Date.now();
    render(nowMs);
    if (cwd && shownInScene(root) && !pageHidden()) poll(nowMs);
  };

  // Called from the render loop only while the widget is mounted, so closing it stops polling.
  const update = (nowMs: number): void => {
    if (disposed) return;
    if (cwd && nowMs - lastPollAt >= pollMs && shownInScene(root) && !pageHidden()) poll(nowMs);
    if (model.kind === 'report' && Math.floor(nowMs / 1000) !== lastRenderSecond) render(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = REPO_STATUS_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  render(Date.now());
  return { root, update, dispose, setFocusedPane };
}
