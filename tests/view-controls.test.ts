// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor, TerminalSurface } from '../src/contracts';
import { createDesktopPanels } from '../src/desktop/panels';
import { mountWorkspaceUI } from '../src/ui';

const pane: PaneDescriptor = {
  id: 'pane-a',
  workspaceId: 'workspace',
  workspaceName: 'Workspace',
  sessionId: 'session',
  sessionName: 'Session',
  windowId: 'window',
  windowName: 'Window',
  title: 'Shell',
};

function surface(status: TerminalSurface['status'] = 'connected'): TerminalSurface {
  const canvas = document.createElement('canvas');
  return {
    canvas,
    pane,
    revision: 1,
    cols: 80,
    rows: 24,
    status,
    error: status === 'error' ? 'Protocol rejected stream frame' : null,
    canResizeGrid: status === 'connected',
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus: () => undefined,
    resizeGrid: () => true,
    setColorMode: () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

describe('held-pane exit badge in the page sidebar', () => {
  const mount = () => {
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    return { root, ui };
  };
  const treeBadge = (root: HTMLElement): string | null =>
    root.querySelector('[data-tree] .pane-exit-badge')?.textContent ?? null;
  const listBadge = (root: HTMLElement): string | null =>
    root.querySelector('[data-panes] .pane-exit-badge')?.textContent ?? null;

  it('shows an unattached held pane from the tree snapshot and clears it on respawn', () => {
    const { root, ui } = mount();
    ui.update({ panes: [{ ...pane, process: { state: 'exited', exitCode: 3 } }] });
    expect(treeBadge(root)).toBe('Exited (code 3)');
    expect(listBadge(root)).toBeNull();
    ui.update({ panes: [{ ...pane, process: { state: 'running' } }] });
    expect(treeBadge(root)).toBeNull();
    ui.destroy();
  });

  it('shows no badge when the tree carries no process field', () => {
    const { root, ui } = mount();
    ui.update({ panes: [pane] });
    expect(treeBadge(root)).toBeNull();
    ui.destroy();
  });

  it('follows the attached surface in both lists and hides the badge on terminal statuses', () => {
    const { root, ui } = mount();
    ui.update({ panes: [pane] });
    ui.setAttachedPaneIds([pane.id]);
    ui.setPaneStatus?.(pane.id, 'connected', { state: 'exited', exitCode: 1 });
    expect(treeBadge(root)).toBe('Exited (code 1)');
    expect(listBadge(root)).toBe('Exited (code 1)');
    ui.setPaneStatus?.(pane.id, 'connected', { state: 'running' });
    expect(treeBadge(root)).toBeNull();
    expect(listBadge(root)).toBeNull();
    ui.setPaneStatus?.(pane.id, 'connected', { state: 'exited' });
    expect(listBadge(root)).toBe('Exited');
    ui.setPaneStatus?.(pane.id, 'closed');
    expect(treeBadge(root)).toBeNull();
    expect(listBadge(root)).toBeNull();
    ui.destroy();
  });

  it('keeps the last live badge in the tree after the viewer is closed', () => {
    const { root, ui } = mount();
    ui.update({ panes: [pane] });
    ui.setAttachedPaneIds([pane.id]);
    ui.setPaneStatus?.(pane.id, 'connected', { state: 'exited', exitCode: 9 });
    ui.setPaneStatus?.(pane.id, 'closed');
    ui.setAttachedPaneIds([]);
    expect(treeBadge(root)).toBe('Exited (code 9)');
    ui.update({ panes: [{ ...pane, process: { state: 'running' } }] });
    expect(treeBadge(root)).toBeNull();
    ui.destroy();
  });

  it('lets the live surface win over the tree while attached', () => {
    const { root, ui } = mount();
    ui.update({ panes: [pane] });
    ui.setAttachedPaneIds([pane.id]);
    ui.setPaneStatus?.(pane.id, 'connected', { state: 'exited', exitCode: 5 });
    ui.update({ panes: [{ ...pane, process: { state: 'running' } }] });
    expect(treeBadge(root)).toBe('Exited (code 5)');
    ui.destroy();
  });
});

describe('terminal view lifecycle controls', () => {
  it('routes browser close and connection actions for attached panes', () => {
    const root = document.createElement('div');
    const onClosePane = vi.fn();
    const onTogglePaneConnection = vi.fn();
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onClosePane,
      onTogglePaneConnection,
    });
    ui.update({ panes: [pane] });
    ui.setAttachedPaneIds([pane.id]);
    ui.setPaneStatus?.(pane.id, 'connected');
    root.querySelector<HTMLButtonElement>('[data-toggle-connection]')?.click();
    root.querySelector<HTMLButtonElement>('[data-close]')?.click();
    expect(onTogglePaneConnection).toHaveBeenCalledWith(pane);
    expect(onClosePane).toHaveBeenCalledWith(pane);
    ui.destroy();
  });

  it('provides desktop close, reconnect, and error context controls', () => {
    const host = document.createElement('div');
    const onClose = vi.fn();
    const onToggleConnection = vi.fn();
    const desktop = createDesktopPanels(host, () => undefined, { onClose, onToggleConnection });
    const terminal = surface('error');
    desktop.add(terminal);
    const panel = host.querySelector<HTMLElement>('[data-pane-id="pane-a"]');
    expect(panel?.textContent).toContain('Reconnect');
    expect(panel?.textContent).toContain('Protocol rejected stream frame');
    panel?.querySelectorAll<HTMLButtonElement>('.desktop-terminal-action')[0]?.click();
    panel?.querySelectorAll<HTMLButtonElement>('.desktop-terminal-action')[1]?.click();
    expect(onToggleConnection).toHaveBeenCalledWith('pane-a');
    expect(onClose).toHaveBeenCalledWith('pane-a');
    desktop.dispose();
  });
});
