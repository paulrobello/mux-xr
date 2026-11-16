import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  actionData,
  assertNever,
  getAction,
  type PanelAction,
  setAction,
} from '../src/xr/panel-actions';

/** Compile-time exhaustiveness: a switch ending in the never-typed branch compiles only when
 * every member is handled; the helper throws if a stray member appears at runtime. */
function _exhaustivePrefix(action: PanelAction): string {
  switch (action.type) {
    case 'scrollStrip':
    case 'noop':
    case 'close':
    case 'grabInput':
    case 'exit':
    case 'openInput':
    case 'dismissNotice':
    case 'dismissToast':
    case 'reloadUpdate':
    case 'handColor':
    case 'armColor':
    case 'accentColor':
    case 'environmentAccentColor':
    case 'closePane':
    case 'toggleConnection':
    case 'bringHere':
    case 'keepHere':
    case 'pasteClipboard':
    case 'pasteHostClipboard':
    case 'copyToHost':
    case 'pictureUrl':
    case 'pictureRecent':
    case 'pictureChange':
    case 'hierarchyNode':
    case 'createPane':
    case 'selectAgentPane':
    case 'selectBellPane':
    case 'pane':
    case 'radialAction':
    case 'wristMenu':
    case 'grabRadial':
    case 'closeWidget':
    case 'grabWidget':
    case 'widgetControl':
    case 'readStickyNote':
    case 'key':
    case 'keyborbMode':
    case 'uiSounds':
    case 'pasteReview':
    case 'zipDigit':
    case 'zipDelete':
    case 'zipClear':
    case 'zipSave':
    case 'zipUnset':
    case 'backgroundSelect':
    case 'backgroundScroll':
    case 'background':
    case 'backgroundTile':
    case 'hierarchyStyle':
    case 'terminalColors':
    case 'windowPreference':
    case 'focusWarpMode':
    case 'scrollStripSide':
    case 'frameChin':
    case 'buttonMapNext':
    case 'buttonMapReset':
    case 'keyboardBackground':
    case 'gazeInput':
    case 'keyboardCurvature':
    case 'dictation':
    case 'pinNote':
    case 'curvature':
    case 'curvatureStep':
    case 'warpDone':
    case 'warpCancel':
    case 'filterDistance':
    case 'filterMode':
    case 'filterAnisotropy':
    case 'filterGaze':
    case 'resetTerminalAppearance':
    case 'glassOpacity':
    case 'fontZoom':
    case 'gridPreset':
    case 'gridStep':
    case 'gridApply':
    case 'newCommand':
    case 'commandCancel':
    case 'commandField':
    case 'commandScope':
    case 'commandNewline':
    case 'commandConfirm':
    case 'commandClear':
    case 'commandSave':
    case 'commandPage':
    case 'commandTool':
    case 'command':
    case 'stripCommand':
    case 'toggleWidget':
    case 'widgetsPage':
    case 'pictureUrlLoad':
    case 'pictureUrlClear':
    case 'pictureRecentPage':
    case 'pictureRecentPlace':
    case 'pictureRecentRemove':
    case 'stickyNotePage':
    case 'resetLayout':
    case 'layoutDepth':
    case 'arrange':
    case 'xrMode':
      return action.type;
    default:
      return assertNever(action);
  }
}

describe('panel actions', () => {
  it('round-trips an action through setAction/getAction', () => {
    const mesh = new THREE.Mesh();
    const action: PanelAction = { type: 'zipDigit', zipDigit: '7' };
    setAction(mesh, action);
    expect(getAction(mesh)).toEqual(action);
  });

  it('spreads payload keys onto userData and keeps the string mirror', () => {
    const mesh = new THREE.Mesh();
    setAction(mesh, { type: 'keyborbMode', keyborbMode: 'auto' });
    expect(mesh.userData.keyborbMode).toBe('auto');
    expect(mesh.userData.inputAction).toBe('keyborbMode');
    expect(mesh.userData.inputAction).toBe(getAction(mesh)?.type);
  });

  it('builds label-button data bags with style keys intact', () => {
    const bag = actionData({ type: 'command', commandId: 'c1' }, { labelBorder: '#fff' });
    expect(bag.inputAction).toBe('command');
    expect(bag.labelBorder).toBe('#fff');
    expect((bag.action as PanelAction).type).toBe('command');
  });

  it('reads a bag that only sets inputAction, as package widgets and keyboard keys do', () => {
    const key = new THREE.Mesh();
    Object.assign(key.userData, { inputAction: 'key', key: 'a', modifier: 'shift' });
    expect(getAction(key)).toEqual({
      inputAction: 'key',
      key: 'a',
      modifier: 'shift',
      type: 'key',
    });
    const close = new THREE.Mesh();
    close.userData.inputAction = 'closeWidget';
    expect(getAction(close)?.type).toBe('closeWidget');
  });

  it('returns undefined for an object with no action', () => {
    expect(getAction(new THREE.Mesh())).toBeUndefined();
  });
});
