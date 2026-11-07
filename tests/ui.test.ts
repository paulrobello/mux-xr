// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { QuickCommand } from '../src/contracts';
import {
  createCommandStore,
  exportServerCommands,
  mergeImportedCommands,
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

  it('shows and dismisses workspace notices safely', () => {
    const root = document.createElement('div');
    const onDismissNotice = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onDismissNotice });
    const notice = query<HTMLElement>(root, '[data-notice]');
    expect(notice.hidden).toBe(true);
    ui.setNotice('Terminal view is no longer available.');
    expect(notice.hidden).toBe(false);
    expect(query<HTMLElement>(notice, '[data-notice-text]').textContent).toBe(
      'Terminal view is no longer available.',
    );
    query<HTMLButtonElement>(notice, '[data-action="dismiss-notice"]').click();
    expect(notice.hidden).toBe(true);
    expect(onDismissNotice).toHaveBeenCalledOnce();
    ui.setNotice('<unsafe>');
    expect(query<HTMLElement>(notice, '[data-notice-text]').innerHTML).toBe('&lt;unsafe&gt;');
    ui.setNotice(null);
    expect(notice.hidden).toBe(true);
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
    expect(validateSettings({ keyborbMode: 'invalid' }).keyborbMode).toBe('auto');
    expect(validateSettings({ keyborbMode: 'on' }).keyborbMode).toBe('on');
  });

  it('defaults UI sounds on and persists the browser and XR toggle', () => {
    expect(validateSettings(null).uiSounds).toBe(true);
    expect(validateSettings({ uiSounds: 'no' }).uiSounds).toBe(true);
    expect(validateSettings({ uiSounds: false }).uiSounds).toBe(false);
    localStorage.clear();
    const root = document.createElement('div');
    const changes: boolean[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (settings) => changes.push(settings.uiSounds),
    });
    const checkbox = query<HTMLInputElement>(root, '[data-settings] [data-ui-sounds]');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(ui.getSettings().uiSounds).toBe(false);
    expect(JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}').uiSounds).toBe(false);
    ui.setUISounds(true, true);
    expect(checkbox.checked).toBe(true);
    expect(changes).toEqual([false, true]);
    ui.destroy();
    localStorage.clear();
  });

  it('persists and synchronizes Keyborb mode selection', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const changes: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (settings) => changes.push(settings.keyborbMode),
    });
    const select = query<HTMLSelectElement>(root, '[data-keyborb-mode]');
    expect(select.getAttribute('aria-label')).toBe('Keyborb');
    expect(select.value).toBe('auto');
    for (const mode of ['off', 'on', 'auto']) {
      select.value = mode;
      select.dispatchEvent(new Event('change'));
      expect(ui.getSettings().keyborbMode).toBe(mode);
      expect(JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}').keyborbMode).toBe(mode);
    }
    ui.setKeyborbMode('off');
    expect(select.value).toBe('off');
    ui.setKeyborbMode('on', true);
    expect(select.value).toBe('on');
    expect(changes).toContain('on');
    ui.destroy();
    localStorage.clear();
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

  it('offers a fresh named entry action when changing XR mode', () => {
    const root = document.createElement('div');
    const enter = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onEnterXR: enter });
    ui.setXREntryMode('ar');
    const button = query<HTMLButtonElement>(root, '[data-action="xr"]');
    expect(button.textContent).toBe('Enter passthrough');
    expect(enter).not.toHaveBeenCalled();
    button.click();
    expect(enter).toHaveBeenCalledOnce();
    ui.setXREntryMode('vr');
    expect(button.textContent).toBe('Enter VR');
    ui.destroy();
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
    expect(root.querySelector('[data-settings] [data-gaze-input]')).toBeNull();
    ui.openInput('commands');
    expect(checkbox.closest<HTMLElement>('[data-keyboard-controls]')?.hidden).toBe(true);
    ui.openInput('keyboard');
    expect(checkbox.closest<HTMLElement>('[data-keyboard-controls]')?.hidden).toBe(false);
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

  it('exposes new-window display defaults separately from per-pane opacity', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const changes: number[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (settings) => changes.push(settings.windowPreferences.defaultOpacity),
    });
    const opacity = query<HTMLInputElement>(root, '[data-window-opacity]');
    const distance = query<HTMLInputElement>(root, '[data-focus-distance]');
    const curvature = query<HTMLInputElement>(root, '[data-focus-curvature]');
    expect(opacity.value).toBe('100');
    expect(distance.value).toBe('1.5');
    expect(curvature.value).toBe('0');
    expect(root.querySelector('legend')?.textContent).toBe('Window and focus preferences');
    expect(opacity.getAttribute('aria-label')).toContain('New window');
    expect(distance.getAttribute('aria-label')).toBe('Focus distance in meters');
    expect(curvature.getAttribute('aria-label')).toBe('Focus curvature in degrees');
    expect(distance.parentElement?.textContent).toContain(
      'Distance in front of you when focusing any window.',
    );
    opacity.value = '65';
    opacity.dispatchEvent(new Event('input'));
    distance.value = '2.4';
    distance.dispatchEvent(new Event('input'));
    curvature.value = '25';
    curvature.dispatchEvent(new Event('input'));
    const stripSide = root.querySelector<HTMLSelectElement>('[data-scroll-strip-side]');
    if (!stripSide) throw new Error('Scroll strip side control missing');
    expect(stripSide.value).toBe('right');
    stripSide.value = 'both';
    stripSide.dispatchEvent(new Event('change'));
    expect(ui.getSettings().windowPreferences).toEqual({
      defaultOpacity: 0.65,
      focusDistance: 2.4,
      focusCurvature: 25,
      scrollStripSide: 'both',
    });
    expect(changes).toEqual([0.65, 0.65, 0.65, 0.65]);
    ui.setWindowPreferences(
      { defaultOpacity: 0.4, focusDistance: 3, focusCurvature: 50, scrollStripSide: 'left' },
      true,
    );
    expect(opacity.value).toBe('40');
    expect(distance.value).toBe('3');
    expect(curvature.value).toBe('50');
    expect(stripSide.value).toBe('left');
    ui.destroy();
    const restored = mountWorkspaceUI(root, { onConnect: () => undefined });
    expect(restored.getSettings().windowPreferences).toEqual({
      defaultOpacity: 0.4,
      focusDistance: 3,
      focusCurvature: 50,
      scrollStripSide: 'left',
    });
    restored.destroy();
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

  it('controls terminal glass opacity per pane without resizing', () => {
    const root = document.createElement('div');
    const opacityChanges: Array<[string, number]> = [];
    const resized: Array<[string, number, number]> = [];
    const pane = (id: string) => ({
      id,
      workspaceId: 'w',
      workspaceName: 'W',
      sessionId: 's',
      sessionName: 'S',
      windowId: 'win',
      windowName: 'Win',
      title: id,
    });
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onResizeGrid: (id, cols, rows) => {
        resized.push([id, cols, rows]);
        return true;
      },
      onTerminalOpacity: (id, value) => opacityChanges.push([id, value]),
    });
    ui.update({ panes: [pane('pane-a'), pane('pane-b')] });
    const opacity = query<HTMLInputElement>(root, '[data-terminal-opacity]');
    expect(opacity.disabled).toBe(true);
    ui.setActivePane('pane-a');
    expect(opacity.value).toBe('100');
    ui.setTerminalOpacity('pane-a', 5);
    expect(opacity.value).toBe('10');
    ui.setTerminalOpacity('pane-a', 105);
    expect(opacity.value).toBe('100');
    opacity.value = '55';
    opacity.dispatchEvent(new Event('input'));
    expect(opacityChanges).toEqual([['pane-a', 55]]);
    ui.setActivePane('pane-b');
    expect(opacity.value).toBe('100');
    ui.setTerminalOpacity('pane-b', 40);
    ui.setActivePane('pane-a');
    expect(opacity.value).toBe('55');
    ui.setAttachedPaneIds([]);
    expect(opacity.disabled).toBe(true);
    expect(resized).toEqual([]);
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

  it('scopes commands by server host and port regardless of scheme or path', () => {
    const scope = workspaceScope('ws://192.0.2.10:4240/ws', '*');
    expect(workspaceScope('wss://192.0.2.10:4240/', '*')).toBe(scope);
    expect(workspaceScope(' HTTP://192.0.2.10:4240/stream?x=1 ', '*')).toBe(scope);
    expect(workspaceScope('https://Example.local', 'w')).toBe(
      workspaceScope('wss://example.local:443/ws', 'w'),
    );
    expect(workspaceScope('ws://example.local', 'w')).not.toBe(
      workspaceScope('wss://example.local', 'w'),
    );
    expect(workspaceScope('not a url', 'w')).toBe('not a url::w');
  });

  it('migrates raw-endpoint command scopes into the server identity scope', () => {
    const storage = new Map<string, string>([
      [
        'mux-xr:commands:v1',
        JSON.stringify({
          'ws://192.0.2.10:4240/ws::*': [command('one'), command('two')],
          'wss://192.0.2.10:4240/::*': [command('two'), command('three')],
          'ws://192.0.2.10:4240/::alpha': [command('a', 'alpha')],
          scope: [command('legacy')],
        }),
      ],
    ]);
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as unknown as Storage;
    const store = createCommandStore(fakeStorage);
    const global = workspaceScope('http://192.0.2.10:4240', '*');
    expect(store.get(global).map((item) => item.id)).toEqual(['one', 'two', 'three']);
    expect(store.get(workspaceScope('wss://192.0.2.10:4240', 'alpha'))).toHaveLength(1);
    expect(store.get('scope').map((item) => item.id)).toEqual(['legacy']);
    expect(Object.keys(JSON.parse(storage.get('mux-xr:commands:v1') ?? '{}')).sort()).toEqual(
      [global, workspaceScope('ws://192.0.2.10:4240', 'alpha'), 'scope'].sort(),
    );
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

  it('moves an edited command between scopes and deletes it from any scope', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const changes = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onCommandsChange: changes });
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
      ],
    });
    ui.addCommand(command('moving'));
    ui.addCommand({ ...command('moving', 'alpha'), label: 'Moved' });
    expect(ui.getCommandsForPane('a').map((item) => item.label)).toEqual(['Moved']);
    expect(ui.addCommand({ ...command('shared:x') })).toBe(false);
    expect(ui.deleteCommand('moving')).toBe(true);
    expect(ui.getCommandsForPane('a')).toEqual([]);
    expect(changes).toHaveBeenCalled();
    ui.destroy();
  });

  it('exports one server with scopes preserved and merges imports by id', () => {
    const server = 'ws://host:4240/ws';
    const values = {
      [workspaceScope(server, '*')]: [command('g'), command('dup')],
      [workspaceScope(server, 'alpha')]: [{ ...command('w'), workspaceId: undefined }],
      [workspaceScope('ws://elsewhere:1', '*')]: [command('other')],
    };
    expect(exportServerCommands(values, 'wss://host:4240')).toEqual([
      { id: 'g', label: 'g', text: 'echo g', sendNewline: true },
      { id: 'dup', label: 'dup', text: 'echo dup', sendNewline: true },
      { id: 'w', label: 'w', text: 'echo w', sendNewline: true, workspaceId: 'alpha' },
    ]);
    const merged = mergeImportedCommands(values, server, [
      { ...command('dup', 'alpha'), label: 'Moved' },
      { ...command('g'), label: 'Renamed' },
      command('new'),
      command('shared:nope'),
    ]);
    expect(merged).toMatchObject({ added: 1, updated: 2, skipped: 1 });
    expect(merged.values[workspaceScope(server, '*')].map((item) => item.label)).toEqual([
      'Renamed',
      'new',
    ]);
    expect(merged.values[workspaceScope(server, 'alpha')].map((item) => item.label)).toEqual([
      'w',
      'Moved',
    ]);
    expect(merged.values[workspaceScope('ws://elsewhere:1', '*')]).toHaveLength(1);
  });

  it('skips repeated and empty imported ids so the first imported copy wins', () => {
    const server = 'ws://host:4240';
    const merged = mergeImportedCommands({}, server, [
      { ...command('dup'), label: 'First' },
      { ...command('dup'), label: 'Second', text: 'rm -rf /' },
      { ...command('blank'), id: '' },
    ]);
    expect(merged).toMatchObject({ added: 1, updated: 0, skipped: 2 });
    expect(merged.values[workspaceScope(server, '*')]).toEqual([
      { id: 'dup', label: 'First', text: 'echo dup', sendNewline: true },
    ]);
  });

  it('imports a command file from the drawer and reports counts', async () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.addCommand(command('keep'));
    ui.openInput('commands');
    const input = query<HTMLInputElement>(root, '[data-command-import]');
    const file = {
      text: async () =>
        JSON.stringify({
          version: 1,
          commands: [{ ...command('keep'), label: 'Kept' }, command('fresh'), { id: 'bad' }],
        }),
    };
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(query<HTMLElement>(root, '[data-detail]').textContent).toBe(
        'Imported 2 quick commands: 1 new, 1 updated, 1 skipped.',
      ),
    );
    expect(ui.getCommandsForPane('none').map((item) => item.label)).toEqual(['Kept', 'fresh']);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ text: async () => '{"nope":true}' }],
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(query<HTMLElement>(root, '[data-detail]').textContent).toBe(
        'Import failed: not a quick command file.',
      ),
    );
    ui.destroy();
    localStorage.clear();
  });

  it('exports the current server commands as a JSON download', async () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.addCommand({ ...command('ls'), confirm: true });
    ui.openInput('commands');
    let blob: Blob | undefined;
    const create = vi.fn((value: Blob) => {
      blob = value;
      return 'blob:commands';
    });
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    query<HTMLButtonElement>(root, '[data-action="export-commands"]').click();
    expect(click).toHaveBeenCalled();
    expect(JSON.parse((await blob?.text()) ?? '')).toEqual({
      version: 1,
      commands: [{ id: 'ls', label: 'ls', text: 'echo ls', sendNewline: true, confirm: true }],
    });
    expect(query<HTMLElement>(root, '[data-detail]').textContent).toBe('Exported 1 quick command.');
    click.mockRestore();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    ui.destroy();
    localStorage.clear();
  });

  it('shows shared commands as a read-only Shared group ahead of local commands', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const runs: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onRunCommand: (item) => runs.push(item.id),
    });
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
      ],
    });
    ui.addCommand(command('local'));
    ui.setSharedCommands([
      command('shared:all'),
      command('shared:alpha', 'alpha'),
      command('shared:beta', 'beta'),
      command('not-namespaced'),
    ]);
    expect(ui.getCommandsForPane('a').map((item) => [item.id, item.shared ?? false])).toEqual([
      ['shared:all', true],
      ['shared:alpha', true],
      ['local', false],
    ]);
    ui.setActivePane('a');
    ui.openInput('commands');
    const group = query<HTMLOptGroupElement>(root, '[data-shared-commands]');
    expect(group.label).toBe('Shared');
    expect([...group.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'shared:all',
    ]);
    const select = query<HTMLSelectElement>(root, '[data-command-select]');
    select.value = 'shared:all';
    for (const action of ['remove-command', 'pin-command', 'move-up']) {
      query<HTMLButtonElement>(root, `[data-action="${action}"]`).click();
      expect(query<HTMLElement>(root, '[data-detail]').textContent).toBe(
        'Shared commands are read-only.',
      );
    }
    select.value = 'shared:all';
    query<HTMLButtonElement>(root, '[data-action="run-command"]').click();
    expect(runs).toEqual(['shared:all']);
    expect(ui.getCommandsForPane('a')).toHaveLength(3);
    ui.destroy();
    localStorage.clear();
  });

  it('records run stats per server without storing them on commands', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.addCommand(command('ls'));
    ui.recordCommandRun('ls', 100);
    ui.recordCommandRun('ls', 250);
    ui.recordCommandRun('shared:deploy', 300);
    expect(ui.getCommandsForPane('none')).toEqual([
      expect.objectContaining({ id: 'ls', lastRunAt: 250, runCount: 2 }),
    ]);
    expect(localStorage.getItem('mux-xr:commands:v1')).not.toContain('runCount');
    const stats = JSON.parse(localStorage.getItem('mux-xr:command-stats:v1') ?? '{}');
    expect(Object.values(stats)).toContainEqual({ lastRunAt: 300, runCount: 1 });
    ui.destroy();
    localStorage.clear();
  });

  it('pins and unpins the selected command from the drawer', () => {
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.addCommand(command('ls'));
    ui.openInput('commands');
    const select = query<HTMLSelectElement>(root, '[data-command-select]');
    select.value = 'ls';
    query<HTMLButtonElement>(root, '[data-action="pin-command"]').click();
    expect(ui.getCommandsForPane('none')[0].pinned).toBe(true);
    expect(select.selectedOptions[0]?.textContent).toBe('ls · pinned');
    query<HTMLButtonElement>(root, '[data-action="pin-command"]').click();
    expect(ui.getCommandsForPane('none')[0].pinned).toBeUndefined();
    ui.destroy();
    localStorage.clear();
  });

  it('asks before running a confirm command and saves the confirm toggle', () => {
    localStorage.clear();
    const root = document.createElement('div');
    document.body.append(root);
    const runs: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onRunCommand: (item, paneId) => runs.push(`${item.id}@${paneId}`),
    });
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
          title: 'Build box',
        },
      ],
    });
    ui.addCommand({ ...command('deploy'), text: 'make deploy\n\u001b', confirm: true });
    ui.setActivePane('a');
    ui.openInput('commands');
    const select = query<HTMLSelectElement>(root, '[data-command-select]');
    select.value = 'deploy';
    select.dispatchEvent(new Event('change'));
    expect(query<HTMLInputElement>(root, '[data-command-confirm]').checked).toBe(true);
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    query<HTMLButtonElement>(root, '[data-action="run-command"]').click();
    expect(confirm).toHaveBeenLastCalledWith('Run "deploy" in Build box?\n\nmake deploy⏎␛');
    expect(runs).toEqual([]);
    query<HTMLButtonElement>(root, '[data-action="run-command"]').click();
    expect(runs).toEqual(['deploy@a']);
    query<HTMLInputElement>(root, '[data-command-confirm]').checked = false;
    query<HTMLButtonElement>(root, '[data-action="save-command"]').click();
    expect(ui.getCommandsForPane('a')[0].confirm).toBeUndefined();
    query<HTMLButtonElement>(root, '[data-action="run-command"]').click();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(runs).toEqual(['deploy@a', 'deploy@a']);
    vi.unstubAllGlobals();
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
