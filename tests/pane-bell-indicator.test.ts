// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor, TerminalSurface } from '../src/contracts';
import { createDesktopPanels } from '../src/desktop/panels';

const pane: PaneDescriptor = {
  id: 'pane-bell',
  workspaceId: 'w',
  workspaceName: 'Workspace',
  sessionId: 's',
  sessionName: 'Session',
  windowId: 'win',
  windowName: 'Window',
  title: 'Terminal',
  cols: 80,
  rows: 24,
};

function surface(): { surface: TerminalSurface; emit: () => void; state: { bell: boolean } } {
  const canvas = document.createElement('canvas');
  const state = { bell: true };
  const listeners = new Set<() => void>();
  const terminal: TerminalSurface = {
    canvas,
    pane,
    revision: 0,
    cols: 80,
    rows: 24,
    status: 'paused' as const,
    error: null,
    get bellPending() {
      return state.bell;
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus: vi.fn(),
    resizeGrid: () => true,
    setColorMode: () => undefined,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
    canResizeGrid: true,
  };
  return {
    surface: terminal,
    emit: () => {
      for (const listener of listeners) listener();
    },
    state,
  };
}

describe('desktop pane bell indicator', () => {
  it('shows BELL for pending notifications, including paused panes, and updates without replacing the canvas', () => {
    const host = document.createElement('div');
    const desktop = createDesktopPanels(host, () => undefined);
    const pending = surface();
    desktop.add(pending.surface);
    const bell = host.querySelector<HTMLElement>('.desktop-terminal-bell');
    expect(bell?.textContent).toBe('BELL');
    expect(bell?.hidden).toBe(false);

    const canvas = pending.surface.canvas;
    pending.state.bell = false;
    pending.emit();
    expect(host.querySelector<HTMLElement>('.desktop-terminal-bell')?.hidden).toBe(true);
    expect(host.querySelector('canvas')).toBe(canvas);
    desktop.dispose();
  });
});
