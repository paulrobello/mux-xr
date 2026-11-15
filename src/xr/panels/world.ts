import type * as THREE from 'three';
import { backgroundPickerRowShowing } from '../background-picker';
import { DESK_WINDOW_KIND } from '../desk-window';
import { XR_ENTRY_LABELS, type XrEntryMode } from '../entry';
import { actionData } from '../panel-actions';
import {
  addColorSwatchRows,
  createBackgroundSelect,
  createLabelButton,
  setModifierVisual,
} from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const worldPanel: PanelModule = {
  title: () => 'World settings',
  closePosition: () => ({ x: 0.22, y: -0.51 }),
  back: () => ({ target: 'settings', x: -0.22, y: -0.51 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const backgroundSelect = createBackgroundSelect(ctx.mutableState.background);
    backgroundSelect.position.y = 0.42;
    root.add(backgroundSelect);
    const activeMode = ctx.widgets.has(DESK_WINDOW_KIND)
      ? 'desk'
      : ctx.mutableState.xrMode === 'ar' && !ctx.mutableState.fullPassthrough
        ? 'vr'
        : ctx.mutableState.xrMode;
    for (const [index, [label, xrMode]] of (
      [
        ['VR', 'vr'],
        ['Passthrough', 'ar'],
        ['Desk Window', 'desk'],
      ] as const
    ).entries()) {
      const button = createLabelButton(label, 0.46, 0.12, actionData({ type: 'xrMode', xrMode }));
      button.position.set((index - 1) * 0.51, 0.28, 0);
      setModifierVisual(button, activeMode === xrMode);
      root.add(button);
    }
    addColorSwatchRows(root, 0.15, [
      ['Hand color', 'handColor', ctx.mutableState.handColor, 'Default'],
      ['Arm color', 'armColor', ctx.mutableState.armColor, 'Match'],
    ]);
    const zip = createLabelButton(
      `Weather ZIP: ${ctx.mutableState.weatherZip || 'not set'}`,
      0.76,
      0.1,
      actionData({ type: 'openInput', mode: 'weather-zip' }),
    );
    zip.name = 'xr-weather-zip-button';
    zip.position.set(-0.4, -0.37, 0);
    const accentButton = createLabelButton(
      'Accent colors',
      0.6,
      0.1,
      actionData({ type: 'openInput', mode: 'accent' }),
    );
    accentButton.name = 'xr-accent-colors-button';
    accentButton.position.set(0.39, -0.37, 0);
    root.add(zip, accentButton);
  },
  handleActionEarly(action, _hit, ctx) {
    switch (action.type) {
      case 'backgroundSelect':
        ctx.backgroundRow = backgroundPickerRowShowing(ctx.mutableState.background, 0);
        ctx.showInput('backgrounds');
        return true;
      default:
        return false;
    }
  },
  handleAction(action, _hit, ctx) {
    if (action.type !== 'xrMode') return false;
    const mode = action.xrMode as XrEntryMode;
    if (
      ctx.mutableState.xrMode === 'ar' &&
      (mode !== 'vr' || ctx.activeSession?.environmentBlendMode === 'alpha-blend')
    ) {
      if (mode === 'desk') ctx.openDeskWindow();
      else {
        ctx.mutableState.fullPassthrough = mode === 'ar';
        if (ctx.widgets.has(DESK_WINDOW_KIND)) ctx.removeWidget(DESK_WINDOW_KIND);
        else {
          ctx.setBackground(ctx.mutableState.background);
          ctx.refreshInputRoot('world');
        }
      }
      return true;
    }
    if (ctx.mutableState.xrMode !== mode) {
      void (async (): Promise<void> => {
        try {
          await ctx.exitXR();
          ctx.actions.setXREntryMode?.(mode);
          ctx.setNotice(`Press ${XR_ENTRY_LABELS[mode]} to continue`);
        } catch (error) {
          ctx.setNotice(error instanceof Error ? error.message : 'XR mode could not be changed');
        }
      })();
    }
    return true;
  },
};
