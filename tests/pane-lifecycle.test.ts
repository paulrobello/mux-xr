// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PaneDescriptor, TerminalSurface } from '../src/contracts';
import { createDesktopPanels } from '../src/desktop/panels';
import {
  paneHeading,
  parsePaneProcess,
  processBadge,
  RUNNING_PROCESS,
  samePaneId,
} from '../src/terminal/lifecycle';

describe('pane lifecycle helpers', () => {
  it('maps the wire vocabulary, treating empty or unknown state as running', () => {
    expect(parsePaneProcess('exited', 0)).toEqual({ state: 'exited', exitCode: 0 });
    expect(parsePaneProcess('exited')).toEqual({ state: 'exited' });
    expect(parsePaneProcess('running', 5)).toBe(RUNNING_PROCESS);
    expect(parsePaneProcess('')).toBe(RUNNING_PROCESS);
    expect(parsePaneProcess('running')).toBe(RUNNING_PROCESS);
    expect(parsePaneProcess('zombie', 1)).toBeNull();
  });

  it('badges only exited panes', () => {
    expect(processBadge(undefined)).toBeNull();
    expect(processBadge(RUNNING_PROCESS)).toBeNull();
    expect(processBadge({ state: 'exited', exitCode: 0 })).toBe('Exited (code 0)');
    expect(processBadge({ state: 'exited', exitCode: 137 })).toBe('Exited (code 137)');
    expect(processBadge({ state: 'exited' })).toBe('Exited');
  });

  it('hides the badge when the stream status already says exited, closed or error', () => {
    const held = { state: 'exited', exitCode: 1 } as const;
    for (const status of ['exited', 'closed', 'error'])
      expect(paneHeading('Build', status, held, null, 28)).toBe(`Build · ${status}`);
    expect(processBadge(held, 'disconnected')).toBe('Exited (code 1)');
  });

  it('normalises pane id spellings', () => {
    expect(samePaneId('%3', 'pane-3')).toBe(true);
    expect(samePaneId('3', '%3')).toBe(true);
    expect(samePaneId('%3', '%4')).toBe(false);
  });

  it('keeps connectivity and the exit badge as separate fields', () => {
    expect(paneHeading('Build', 'connected', { state: 'exited', exitCode: 2 }, null, 28)).toBe(
      'Build · connected · Exited (code 2)',
    );
    expect(paneHeading('Build', 'disconnected', RUNNING_PROCESS, 'boom', 28)).toBe(
      'Build · disconnected · boom',
    );
  });
});

const pane: PaneDescriptor = {
  id: 'pane-1',
  workspaceId: 'w',
  workspaceName: 'W',
  sessionId: 's',
  sessionName: 'S',
  windowId: 'win',
  windowName: 'Win',
  title: 'Build',
  cols: 10,
  rows: 5,
};

describe('desktop panel exit badge', () => {
  it('shows the held state next to, not instead of, connectivity, and clears on respawn', () => {
    const listeners = new Set<() => void>();
    let process: TerminalSurface['process'] = RUNNING_PROCESS;
    const surface = {
      canvas: document.createElement('canvas'),
      pane,
      revision: 0,
      cols: 10,
      rows: 5,
      status: 'connected',
      error: null,
      get process() {
        return process;
      },
      canResizeGrid: true,
      connect: () => undefined,
      disconnect: () => undefined,
      sendText: () => true,
      sendKey: () => true,
      paste: () => true,
      focus: () => undefined,
      resizeGrid: () => true,
      setColorMode: () => undefined,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => undefined,
    } as TerminalSurface;
    const host = document.createElement('div');
    createDesktopPanels(host, () => undefined).add(surface);
    const heading = (): HTMLElement => {
      const el = host.querySelector<HTMLElement>('.desktop-terminal-heading');
      if (!el) throw new Error('missing heading');
      return el;
    };
    expect(heading().textContent).toBe('Build · connected');
    process = { state: 'exited', exitCode: 3 };
    for (const listener of listeners) listener();
    expect(heading().textContent).toBe('Build · connected · Exited (code 3)');
    process = RUNNING_PROCESS;
    for (const listener of listeners) listener();
    expect(heading().textContent).toBe('Build · connected');
    expect(host.querySelectorAll('[data-pane-id]')).toHaveLength(1);
  });
});
