// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { QuickCommand } from '../src/contracts';
import {
  createCommandStore,
  mountWorkspaceUI,
  reorderCommands,
  validateSettings,
  workspaceScope,
} from '../src/ui';

const command = (id: string, workspaceId?: string): QuickCommand => ({
  id,
  label: id,
  text: `echo ${id}`,
  sendNewline: true,
  workspaceId,
});
const query = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
};

describe('mux XR local UI state', () => {
  it('keeps locked Shift active until tapped and resets one-shot labels', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const sent: Array<{ key: string; shift?: boolean }> = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendKey: (_pane, key, modifiers) => sent.push({ key, shift: modifiers?.shift }),
    });
    const makePane = (id: string) => ({
      id,
      workspaceId: 'w',
      workspaceName: 'W',
      sessionId: 's',
      sessionName: 'S',
      windowId: 'win',
      windowName: 'Win',
      title: id,
    });
    ui.update({ panes: [makePane('pane-a'), makePane('pane-b')] });
    ui.setActivePane('pane-a');
    ui.openInput('keyboard');
    const shift = root.querySelector<HTMLButtonElement>('[data-key="Shift"]');
    const letter = root.querySelector<HTMLButtonElement>('[data-key="a"]');
    if (!shift || !letter) throw new Error('keyboard controls missing');
    shift.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(550);
    shift.dispatchEvent(new Event('pointerup', { bubbles: true }));
    shift.click();
    expect(shift.classList.contains('locked')).toBe(true);
    letter.click();
    letter.click();
    expect(sent).toEqual([
      { key: 'a', shift: true },
      { key: 'a', shift: true },
    ]);
    expect(letter.textContent).toBe('A');
    shift.click();
    expect(shift.classList.contains('locked')).toBe(false);
    expect(letter.textContent).toBe('a');
    shift.click();
    letter.click();
    expect(letter.textContent).toBe('a');
    shift.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    ui.setActivePane('pane-b');
    vi.advanceTimersByTime(600);
    expect(shift.classList.contains('locked')).toBe(false);
    ui.destroy();
    vi.useRealTimers();
  });

  it('shows the update notice only when available and reloads on explicit click', () => {
    const root = document.createElement('div');
    const onReloadApp = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onReloadApp });
    const notice = query<HTMLElement>(root, '[data-update-notice]');
    expect(notice.hidden).toBe(true);
    ui.setUpdateAvailable(true);
    expect(notice.hidden).toBe(false);
    query<HTMLButtonElement>(notice, '[data-action="reload-update"]').click();
    expect(onReloadApp).toHaveBeenCalledOnce();
    ui.setUpdateAvailable(false);
    expect(notice.hidden).toBe(true);
    expect(onReloadApp).toHaveBeenCalledOnce();
    ui.destroy();
  });

  it('falls back safely for malformed or outdated settings', () => {
    expect(validateSettings(null)).toMatchObject({
      version: 1,
      background: 'observatory',
      gazeInput: false,
    });
    expect(
      validateSettings({ version: 9, endpoint: 42, background: 'laser', gazeEmphasis: 'yes' }),
    ).toMatchObject({ version: 1, endpoint: '', background: 'observatory', gazeInput: false });
    expect(
      validateSettings({ endpoint: 'WSS://LAN', background: 'black', gazeEmphasis: false }),
    ).toMatchObject({
      version: 1,
      endpoint: 'WSS://LAN',
      background: 'black',
      arrangement: 'arc',
    });
    expect(validateSettings({ arrangement: 'invalid' }).arrangement).toBe('arc');
  });

  it('applies an explicit 3D arrangement only when terminals are attached', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const arranged: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onArrange: (pattern) => arranged.push(pattern),
    });
    const select = query<HTMLSelectElement>(root, '[data-arrangement]');
    const apply = query<HTMLButtonElement>(root, '[data-action="apply-arrangement"]');
    expect(select.value).toBe('arc');
    expect(apply.disabled).toBe(true);
    select.value = 'grid';
    select.dispatchEvent(new Event('change'));
    expect(arranged).toEqual([]);
    expect(ui.getSettings().arrangement).toBe('arc');
    ui.setAttachedPaneIds(['pane-a']);
    expect(apply.disabled).toBe(false);
    apply.click();
    expect(arranged).toEqual(['grid']);
    expect(ui.getSettings().arrangement).toBe('grid');
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(restored.getSettings().arrangement).toBe('grid');
    restored.setArrangement('sphere');
    expect(query<HTMLSelectElement>(root, '[data-arrangement]').value).toBe('sphere');
    expect(restored.getSettings().arrangement).toBe('sphere');
    restored.destroy();
    localStorage.clear();
  });

  it('keeps gaze keyboard routing opt-in and persists changes from browser and XR', () => {
    expect(validateSettings({ gazeInput: 'true' }).gazeInput).toBe(false);
    localStorage.clear();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const changes: boolean[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (settings) => changes.push(settings.gazeInput),
    });
    const checkbox = query<HTMLInputElement>(root, '[data-gaze-input]');
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    expect(ui.getSettings().gazeInput).toBe(true);
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(query<HTMLInputElement>(root, '[data-gaze-input]').checked).toBe(true);
    restored.setGazeInputEnabled(false);
    expect(query<HTMLInputElement>(root, '[data-gaze-input]').checked).toBe(false);
    restored.destroy();
    const again = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(again.getSettings().gazeInput).toBe(false);
    expect(changes).toEqual([true]);
    again.destroy();
    root.remove();
    localStorage.clear();
  });

  it('exposes all terminal filtering controls, persists them, and restores their live state', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const changes: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (settings) => changes.push(JSON.stringify(settings.filtering)),
    });
    expect(ui.getSettings().filtering).toEqual({
      mode: 'mipmap-linear',
      anisotropy: 4,
      gazeClarity: true,
      gazeMaxDistance: 3,
    });
    const mode = query<HTMLSelectElement>(root, '[data-filter-mode]');
    const anisotropy = query<HTMLSelectElement>(root, '[data-filter-anisotropy]');
    const gaze = query<HTMLInputElement>(root, '[data-filter-gaze]');
    const distance = query<HTMLInputElement>(root, '[data-filter-distance]');
    const distanceRow = query<HTMLElement>(root, '[data-filter-distance-row]');
    const anisotropyRow = query<HTMLElement>(root, '[data-filter-anisotropy-row]');
    expect(distance.min).toBe('0.25');
    expect(distance.max).toBe('20');
    expect(distance.step).toBe('0.25');
    expect(distance.value).toBe('3');
    expect(distanceRow.hidden).toBe(false);
    expect(anisotropyRow.hidden).toBe(false);
    expect([...mode.options].map((option) => option.value)).toEqual([
      'nearest',
      'linear',
      'mipmap-nearest',
      'mipmap-linear',
    ]);
    for (const value of ['nearest', 'linear', 'mipmap-nearest', 'mipmap-linear']) {
      mode.value = value;
      mode.dispatchEvent(new Event('change'));
      expect(ui.getSettings().filtering.mode).toBe(value);
      expect(anisotropyRow.hidden).toBe(value === 'nearest' || value === 'linear');
      expect(distanceRow.hidden).toBe(value === 'nearest' || value === 'linear' || !gaze.checked);
    }
    for (const value of ['1', '2', '4', '8', '16']) {
      anisotropy.value = value;
      anisotropy.dispatchEvent(new Event('change'));
      expect(ui.getSettings().filtering.anisotropy).toBe(Number(value));
    }
    distance.value = '6.25';
    distance.dispatchEvent(new Event('change'));
    expect(ui.getSettings().filtering.gazeMaxDistance).toBe(6.25);
    gaze.checked = false;
    gaze.dispatchEvent(new Event('change'));
    expect(ui.getSettings().filtering.gazeClarity).toBe(false);
    expect(distanceRow.hidden).toBe(true);
    ui.setFilteringCapabilities(4);
    expect(
      query<HTMLOptionElement>(root, '[data-filter-anisotropy] option[value="8"]').hidden,
    ).toBe(true);
    expect(
      query<HTMLOptionElement>(root, '[data-filter-anisotropy] option[value="4"]').hidden,
    ).toBe(false);
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(query<HTMLSelectElement>(root, '[data-filter-mode]').value).toBe('mipmap-linear');
    expect(query<HTMLSelectElement>(root, '[data-filter-anisotropy]').value).toBe('4');
    expect(query<HTMLInputElement>(root, '[data-filter-gaze]').checked).toBe(false);
    expect(restored.getSettings().filtering).toEqual({
      mode: 'mipmap-linear',
      anisotropy: 4,
      gazeClarity: false,
      gazeMaxDistance: 6.25,
    });
    expect(changes.length).toBe(12);
    restored.destroy();
    localStorage.clear();
  });

  it('defaults missing or invalid persisted filtering without disturbing other settings', () => {
    localStorage.setItem(
      'mux-xr:settings:v1',
      JSON.stringify({
        version: 1,
        endpoint: 'WSS://example.test',
        background: 'black',
        gazeInput: true,
        colorMode: 'original',
        keyboardBackground: false,
        arrangement: 'grid',
      }),
    );
    expect(
      validateSettings(JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}')).filtering,
    ).toEqual({
      mode: 'mipmap-linear',
      anisotropy: 4,
      gazeClarity: true,
      gazeMaxDistance: 3,
    });
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(ui.getSettings().endpoint).toBe('WSS://example.test');
    ui.destroy();
    localStorage.setItem(
      'mux-xr:settings:v1',
      JSON.stringify({
        version: 1,
        endpoint: 'WSS://example.test',
        background: 'black',
        filtering: { mode: 'invalid', anisotropy: 999, gazeClarity: 'yes' },
      }),
    );
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(restored.getSettings().filtering).toEqual({
      mode: 'mipmap-linear',
      anisotropy: 16,
      gazeClarity: true,
      gazeMaxDistance: 3,
    });
    expect(restored.getSettings().background).toBe('black');
    restored.destroy();
    localStorage.clear();
  });

  it('routes the Widgets control to onWidgets independently of desktop keyboard input', () => {
    const root = document.createElement('div');
    const onWidgets = vi.fn();
    const onSendKey = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onWidgets, onSendKey });
    query<HTMLButtonElement>(root, '[data-action="widgets"]').click();
    expect(onWidgets).toHaveBeenCalledOnce();
    expect(onSendKey).not.toHaveBeenCalled();
    query<HTMLButtonElement>(root, '[data-action="keyboard"]').click();
    expect(onWidgets).toHaveBeenCalledOnce();
    expect(onSendKey).not.toHaveBeenCalled();
    ui.destroy();
  });

  it('returns command persistence status and writes workspace scope independently of visible scope', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(ui.addCommand(command('workspace-only', 'alpha'))).toBe(true);
    expect(ui.getCommandsForPane('missing')).toEqual([]);
    expect(ui.addCommand({ id: 'bad' } as never)).toBe(false);
    const originalSetItem = localStorage.setItem;
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('storage unavailable');
      },
    });
    expect(ui.updateCommand(command('failed'))).toBe(false);
    Object.defineProperty(localStorage, 'setItem', { configurable: true, value: originalSetItem });
    ui.destroy();
    localStorage.clear();
  });

  it('persists comfort settings and targets the selected pane for grid resize', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const resized: Array<[string, number, number]> = [];
    const curved: Array<[string, number]> = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onResizeGrid: (id, cols, rows) => {
        resized.push([id, cols, rows]);
        return true;
      },
      onTerminalCurvature: (id, degrees) => curved.push([id, degrees]),
    });
    ui.update({
      panes: [
        {
          id: 'pane-a',
          workspaceId: 'w',
          workspaceName: 'W',
          sessionId: 's',
          sessionName: 'S',
          windowId: 'win',
          windowName: 'Win',
          title: 'A',
        },
        {
          id: 'pane-b',
          workspaceId: 'w',
          workspaceName: 'W',
          sessionId: 's',
          sessionName: 'S',
          windowId: 'win',
          windowName: 'Win',
          title: 'B',
        },
      ],
    });
    ui.setActivePane('pane-a');
    ui.setTerminalGrid('pane-a', 80, 24, true);
    const curvature = query<HTMLInputElement>(root, '[data-terminal-curvature]');
    expect(curvature.disabled).toBe(false);
    expect(curvature.value).toBe('0');
    curvature.value = '35';
    curvature.dispatchEvent(new Event('input'));
    expect(curved).toEqual([['pane-a', 35]]);
    expect(resized).toEqual([]);
    ui.setActivePane('pane-b');
    expect(curvature.value).toBe('0');
    ui.setTerminalCurvature('pane-b', 70);
    expect(curvature.value).toBe('70');
    ui.setActivePane('pane-a');
    expect(curvature.value).toBe('35');
    query<HTMLSelectElement>(root, '[data-color-mode]').value = 'monochrome';
    query<HTMLSelectElement>(root, '[data-color-mode]').dispatchEvent(new Event('change'));
    const keyboardBackground = query<HTMLInputElement>(root, '[data-keyboard-background]');
    keyboardBackground.click();
    keyboardBackground.dispatchEvent(new Event('change'));
    query<HTMLInputElement>(root, '[data-grid-cols]').value = '0';
    query<HTMLButtonElement>(root, '[data-action="apply-grid"]').click();
    expect(resized).toEqual([]);
    expect(query<HTMLElement>(root, '[data-grid-status]').textContent).toContain('2–300');
    query<HTMLInputElement>(root, '[data-grid-cols]').value = '100';
    query<HTMLInputElement>(root, '[data-grid-rows]').value = '30';
    query<HTMLButtonElement>(root, '[data-action="apply-grid"]').click();
    expect(resized).toEqual([['pane-a', 100, 30]]);
    ui.setTerminalGrid('pane-a', 80, 24, false);
    expect(query<HTMLButtonElement>(root, '[data-action="apply-grid"]').disabled).toBe(true);
    ui.setAttachedPaneIds([]);
    expect(query<HTMLElement>(root, '[data-grid-caption]').textContent).toContain('No terminal');
    expect(curvature.disabled).toBe(true);
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(restored.getSettings()).toMatchObject({
      colorMode: 'monochrome',
      keyboardBackground: false,
    });
    restored.destroy();
    localStorage.clear();
  });

  it('preserves an edited grid draft across output updates until matching acknowledgement', () => {
    const root = document.createElement('div');
    const resized: Array<[string, number, number]> = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onResizeGrid: (id, cols, rows) => {
        resized.push([id, cols, rows]);
        return true;
      },
    });
    ui.update({
      panes: [
        {
          id: 'pane-a',
          workspaceId: 'w',
          workspaceName: 'W',
          sessionId: 's',
          sessionName: 'S',
          windowId: 'win',
          windowName: 'Win',
          title: 'A',
        },
      ],
    });
    ui.setActivePane('pane-a');
    ui.setTerminalGrid('pane-a', 80, 24, true);
    query<HTMLInputElement>(root, '[data-grid-cols]').value = '120';
    query<HTMLInputElement>(root, '[data-grid-rows]').value = '36';
    query<HTMLButtonElement>(root, '[data-action="apply-grid"]').click();
    ui.setTerminalGrid('pane-a', 80, 24, true);
    expect(resized).toEqual([['pane-a', 120, 36]]);
    expect(query<HTMLInputElement>(root, '[data-grid-cols]').value).toBe('120');
    expect(query<HTMLInputElement>(root, '[data-grid-rows]').value).toBe('36');
    ui.setTerminalGrid('pane-a', 120, 36, true);
    expect(query<HTMLElement>(root, '[data-grid-status]').textContent).toContain('Resize changes');
    ui.destroy();
  });

  it('prefills the serving origin and restores a saved custom endpoint', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(query<HTMLInputElement>(root, '#endpoint').value).toBe(location.origin);
    const custom = 'https://other-computer.local:4240';
    query<HTMLInputElement>(root, '#endpoint').value = custom;
    query<HTMLButtonElement>(root, '[data-action="connect"]').click();
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(query<HTMLInputElement>(root, '#endpoint').value).toBe(custom);
    restored.destroy();
    localStorage.clear();
  });

  it('isolates command lists by endpoint and workspace and preserves order', () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as unknown as Storage;
    const store = createCommandStore(fakeStorage);
    const firstScope = workspaceScope('wss://one', 'alpha');
    const secondScope = workspaceScope('wss://one', 'beta');
    store.set(firstScope, [command('one'), command('two')]);
    store.set(secondScope, [command('other')]);
    expect(store.get(firstScope).map((item) => item.id)).toEqual(['one', 'two']);
    expect(store.get(secondScope).map((item) => item.id)).toEqual(['other']);
    expect(reorderCommands(store.get(firstScope), 1, 0).map((item) => item.id)).toEqual([
      'two',
      'one',
    ]);
    expect(store.get(firstScope).map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('rejects malformed persisted commands', () => {
    const storage = new Map<string, string>([
      ['mux-xr:commands:v1', JSON.stringify({ scope: [command('good'), { id: 'bad' }] })],
    ]);
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => undefined,
    } as unknown as Storage;
    expect(
      createCommandStore(fakeStorage)
        .get('scope')
        .map((item) => item.id),
    ).toEqual(['good']);
  });

  it('returns false and keeps persisted commands when storage throws', () => {
    const stored = JSON.stringify({ scope: [command('kept')] });
    const storage = {
      getItem: () => stored,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    } as unknown as Storage;
    const store = createCommandStore(storage);
    expect(store.set('scope', [command('new')])).toBe(false);
    expect(store.get('scope').map((item) => item.id)).toEqual(['kept']);
  });

  it('retargets an open drawer when explicit selection changes', () => {
    const sent: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendText: (paneId) => sent.push(paneId),
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'B',
        },
      ],
    });
    ui.setActivePane('a');
    query<HTMLButtonElement>(root, '[data-action="keyboard"]').click();
    ui.setActivePane('b');
    const compose = query<HTMLTextAreaElement>(root, '[data-compose]');
    compose.value = 'echo stable';
    query<HTMLButtonElement>(root, '[data-action="send-text"]').click();
    expect(sent).toEqual(['b']);
    ui.destroy();
  });

  it('keeps commands and keyboard drawer views separate while preserving the target', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
      ],
    });
    ui.setActivePane('a');
    ui.openInput('commands');
    expect(query<HTMLElement>(root, '[data-drawer-heading]').textContent).toBe('Commands');
    expect(query<HTMLElement>(root, '[data-command-controls]').hidden).toBe(false);
    expect(query<HTMLElement>(root, '[data-keyboard-controls]').hidden).toBe(true);
    ui.openInput('keyboard');
    expect(query<HTMLElement>(root, '[data-drawer-heading]').textContent).toBe('Keyboard');
    expect(query<HTMLElement>(root, '[data-command-controls]').hidden).toBe(true);
    expect(query<HTMLElement>(root, '[data-keyboard-controls]').hidden).toBe(false);
    expect(query<HTMLElement>(root, '[data-detail]').textContent).toContain('Input target: A');
    ui.destroy();
  });

  it('closes the input drawer and clears held modifiers', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.openInput('keyboard');
    const shift = query<HTMLButtonElement>(root, '[data-key="Shift"]');
    shift.click();
    expect(shift.classList.contains('active')).toBe(true);
    ui.closeInput();
    expect(query<HTMLElement>(root, '[data-drawer]').hidden).toBe(true);
    expect(shift.classList.contains('active')).toBe(false);
    expect(query<HTMLButtonElement>(root, '[data-key="a"]').textContent).toBe('a');
    ui.destroy();
  });

  it('renders lowercase base keys and restores them after Shift', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    const keyA = query<HTMLButtonElement>(root, '[data-key="a"]');
    expect(keyA.textContent).toBe('a');
    query<HTMLButtonElement>(root, '[data-key="Shift"]').click();
    expect(keyA.textContent).toBe('A');
    expect(query<HTMLButtonElement>(root, '[data-key="4"]').textContent).toBe('$');
    query<HTMLButtonElement>(root, '[data-key="a"]').click();
    expect(keyA.textContent).toBe('a');
    expect(query<HTMLButtonElement>(root, '[data-key="4"]').textContent).toBe('4');
    expect(query<HTMLButtonElement>(root, '[data-key="ArrowUp"]').textContent).toBe('↑');
    ui.destroy();
  });

  it('routes public commands to endpoint-global or exact workspace buckets', () => {
    localStorage.clear();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'alpha',
          workspaceName: 'Alpha',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'w',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'beta',
          workspaceName: 'Beta',
          sessionId: 's',
          sessionName: 'Ops',
          windowId: 'w',
          windowName: 'Shell',
          title: 'B',
        },
      ],
    });
    ui.addCommand(command('global'));
    ui.addCommand(command('alpha', 'alpha'));
    expect(ui.getCommandsForPane('a').map((item) => item.id)).toEqual(['global', 'alpha']);
    expect(ui.getCommandsForPane('b').map((item) => item.id)).toEqual(['global']);
    ui.destroy();
  });

  it('detaches a captured pane without sending to the replacement selection', () => {
    const sent: string[] = [];
    const closed: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendText: (id) => sent.push(id),
      onClosePane: (pane) => closed.push(pane.id),
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'B',
        },
      ],
    });
    ui.setActivePane('a');
    ui.openInput('commands');
    ui.setActivePane('b');
    query<HTMLButtonElement>(root, '[data-action="close-drawer"]').click();
    expect(query<HTMLElement>(root, '[data-detail]').textContent).toContain('Input target: B');
    expect(closed).toEqual([]);
    expect(sent).toEqual([]);
    ui.destroy();
  });

  it('reset preserves command data', () => {
    localStorage.clear();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onResetLayout: () => undefined,
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
      ],
    });
    ui.addCommand(command('keep'));
    query<HTMLButtonElement>(root, '[data-action="settings"]').click();
    query<HTMLButtonElement>(root, '[data-action="reset"]').click();
    expect(ui.getCommands().map((item) => item.id)).toContain('keep');
    ui.destroy();
  });
});
