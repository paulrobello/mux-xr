import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type {
  RepoStatusFetcher,
  RepoStatusReport,
  RepoStatusResult,
} from '../src/host-repo-status';
import {
  createRepoStatusWidget,
  REPO_BADGE_COLORS,
  REPO_STATUS_POLL_MS,
  repoStatusView,
} from '../src/xr/repo-status-widget';

const report = (overrides: Partial<Extract<RepoStatusReport, { state: 'ok' }>> = {}) =>
  ({
    state: 'ok',
    repo: 'mux-xr',
    branch: 'main',
    detached: false,
    upstream: true,
    ahead: 2,
    behind: 1,
    dirty: true,
    ci: {
      state: 'success',
      conclusion: 'success',
      status: 'completed',
      workflow: 'CI',
      createdAt: '2026-11-11T10:00:00Z',
    },
    ...overrides,
  }) as RepoStatusReport;

const text = (widget: ReturnType<typeof createRepoStatusWidget>, name: string): string =>
  String(widget.root.getObjectByName(name)?.userData.labelText ?? '');

const deferredFetcher = () => {
  const calls: Array<{
    cwd: string;
    host: string | null;
    resolve: (result: RepoStatusResult) => void;
  }> = [];
  const fetch: RepoStatusFetcher = (cwd, host) =>
    new Promise((resolve) => {
      calls.push({ cwd, host, resolve });
    });
  return { fetch, calls };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('repo status view', () => {
  const now = Date.parse('2026-11-11T10:05:00Z');

  it('shows the repo basename, branch, dirty and ahead/behind counts and a CI badge', () => {
    expect(repoStatusView({ kind: 'report', report: report() }, now)).toEqual({
      title: 'mux-xr',
      branch: 'main',
      detail: 'dirty · 2 ahead · 1 behind',
      badge: 'CI passed',
      tone: 'success',
      ciDetail: 'CI · 5m ago',
    });
  });

  it('labels each CI state', () => {
    for (const [state, badge] of [
      ['failure', 'CI failed'],
      ['in_progress', 'CI running'],
      ['unknown', 'CI unknown'],
    ] as const) {
      const view = repoStatusView(
        {
          kind: 'report',
          report: report({
            ci: { state, conclusion: null, status: null, workflow: null, createdAt: null },
          }),
        },
        now,
      );
      expect([view.badge, view.tone]).toEqual([badge, state]);
    }
    const noCi = repoStatusView({ kind: 'report', report: report({ ci: null }) }, now);
    expect([noCi.badge, noCi.tone, noCi.ciDetail]).toEqual([
      'CI unavailable',
      'none',
      'gh has no data for this repo',
    ]);
  });

  it('describes clean, in-sync, untracked and detached repos', () => {
    const view = (overrides: Partial<Extract<RepoStatusReport, { state: 'ok' }>>) =>
      repoStatusView({ kind: 'report', report: report(overrides) }, now);
    expect(view({ dirty: false, ahead: 0, behind: 0 }).detail).toBe('clean · in sync');
    expect(view({ upstream: false }).detail).toBe('dirty · no upstream');
    expect(view({ detached: true, branch: null }).branch).toBe('detached HEAD');
    expect(view({ dirty: null, ahead: 0, behind: 0 }).detail).toBe('state unknown · in sync');
  });

  it('has clear unknown and unavailable states', () => {
    expect(repoStatusView({ kind: 'no-pane' }, now).branch).toBe('No pane focused');
    expect(repoStatusView({ kind: 'no-cwd' }, now).branch).toBe('Directory unknown');
    expect(repoStatusView({ kind: 'loading' }, now).branch).toBe('Checking…');
    expect(repoStatusView({ kind: 'report', report: { state: 'not-a-repo' } }, now).branch).toBe(
      'Not a git repository',
    );
    const remote = repoStatusView({ kind: 'report', report: { state: 'remote' } }, now);
    expect([remote.branch, remote.detail]).toEqual(['Remote shell', 'The pane is on another host']);
    const failed = repoStatusView({ kind: 'failed', code: 'no-secret' }, now);
    expect([failed.branch, failed.detail, failed.badge]).toEqual([
      'Unavailable',
      'Pair the host clipboard in Settings',
      '',
    ]);
  });
});

describe('repo status widget', () => {
  it('follows pane focus and drops answers for a pane that lost focus', async () => {
    const fetcher = deferredFetcher();
    const widget = createRepoStatusWidget(null, {
      fetchStatus: fetcher.fetch,
      pageHidden: () => false,
    });
    expect(text(widget, 'repo-status-branch')).toBe('No pane focused');

    widget.setFocusedPane?.('pane-a', '/Users/me/a');
    expect(fetcher.calls.map((call) => call.cwd)).toEqual(['/Users/me/a']);
    expect(text(widget, 'repo-status-branch')).toBe('Checking…');

    widget.setFocusedPane?.('pane-b', '/Users/me/b');
    expect(fetcher.calls.map((call) => call.cwd)).toEqual(['/Users/me/a', '/Users/me/b']);
    fetcher.calls[0].resolve({ ok: true, report: report({ repo: 'stale' }) });
    await flush();
    expect(text(widget, 'repo-status-title')).toBe('Git & CI');

    fetcher.calls[1].resolve({ ok: true, report: report({ repo: 'b-repo' }) });
    await flush();
    expect(text(widget, 'repo-status-title')).toBe('b-repo');
    expect(text(widget, 'repo-status-badge')).toBe('CI passed');
    const plate = widget.root.getObjectByName('repo-status-badge-plate') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(plate.material.color.getHex()).toBe(REPO_BADGE_COLORS.success);

    widget.setFocusedPane?.('pane-b', '/Users/me/b');
    expect(fetcher.calls).toHaveLength(2);
    widget.setFocusedPane?.('pane-c', null);
    expect(text(widget, 'repo-status-branch')).toBe('Directory unknown');
    expect(fetcher.calls).toHaveLength(2);
    widget.setFocusedPane?.(null, null);
    expect(text(widget, 'repo-status-branch')).toBe('No pane focused');
    widget.dispose();
  });

  it('forwards the OSC 7 host and refetches when only the host changes', () => {
    const fetcher = deferredFetcher();
    const widget = createRepoStatusWidget(null, {
      fetchStatus: fetcher.fetch,
      pageHidden: () => false,
    });
    widget.setFocusedPane?.('pane-a', '/Users/me/a');
    widget.setFocusedPane?.('pane-a', '/Users/me/a', 'build-box');
    widget.setFocusedPane?.('pane-a', '/Users/me/a', 'build-box');
    expect(fetcher.calls.map(({ cwd, host }) => [cwd, host])).toEqual([
      ['/Users/me/a', null],
      ['/Users/me/a', 'build-box'],
    ]);
    widget.dispose();
  });

  it('polls on its interval only while shown and the page is visible', async () => {
    let hidden = false;
    const fetch = vi.fn<RepoStatusFetcher>(async () => ({ ok: true, report: report() }));
    const widget = createRepoStatusWidget(null, { fetchStatus: fetch, pageHidden: () => hidden });
    widget.setFocusedPane?.('pane-a', '/Users/me/a');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const start = Date.now();
    widget.update(start + REPO_STATUS_POLL_MS / 2);
    expect(fetch).toHaveBeenCalledTimes(1);
    widget.update(start + REPO_STATUS_POLL_MS + 1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);

    widget.root.visible = false;
    widget.update(start + REPO_STATUS_POLL_MS * 3);
    widget.root.visible = true;
    hidden = true;
    widget.update(start + REPO_STATUS_POLL_MS * 4);
    expect(fetch).toHaveBeenCalledTimes(2);
    hidden = false;
    widget.update(start + REPO_STATUS_POLL_MS * 5);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);

    widget.dispose();
    widget.update(start + REPO_STATUS_POLL_MS * 10);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('shows a failed query as unavailable and keeps polling', async () => {
    const fetch = vi.fn<RepoStatusFetcher>(async () => ({ ok: false, code: 'disabled' }));
    const widget = createRepoStatusWidget(null, { fetchStatus: fetch, pageHidden: () => false });
    widget.setFocusedPane?.('pane-a', '/Users/me/a');
    await flush();
    expect(text(widget, 'repo-status-branch')).toBe('Unavailable');
    expect(text(widget, 'repo-status-detail')).toBe('Repo status is off on the Mac');
    widget.update(Date.now() + REPO_STATUS_POLL_MS + 1);
    expect(fetch).toHaveBeenCalledTimes(2);
    widget.dispose();
  });
});
