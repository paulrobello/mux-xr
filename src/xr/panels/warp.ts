import type * as THREE from 'three';
import { MAX_TERMINAL_CURVATURE_DEGREES } from '../../workspace/window-preferences';
import { actionData } from '../panel-actions';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const warpPanel: PanelModule = {
  title: () => 'Terminal curvature',
  onShow(ctx, source) {
    if (ctx.renderer?.xr.isPresenting && !(source && ctx.activeHand(source))) {
      ctx.startWarp(ctx.mutableState.selectedTerminalId, null);
      return true;
    }
    if (ctx.mutableState.focusModeTerminalId) ctx.endFocusMode(true);
    return false;
  },
  onPrepare(ctx, targetId) {
    if (ctx.warpPanelEdit?.id !== targetId) {
      ctx.settleWarpPanel(false);
      if (targetId)
        ctx.setWarpPanelEdit({
          id: targetId,
          original: ctx.getTerminalCurvature(targetId),
          touched: false,
        });
    }
  },
  build(root: THREE.Group, ctx: SceneContext): void {
    const target = ctx.mutableState.inputTargetId;
    const degrees = target ? ctx.getTerminalCurvature(target) : 0;
    const caption = createLabelButton(
      target ? `Curvature: ${degrees}°` : 'Select a terminal',
      1.4,
      0.14,
      actionData({ type: 'noop' }),
    );
    caption.position.y = 0.3;
    root.add(caption);
    for (const [index, value] of [
      0,
      15,
      30,
      45,
      60,
      90,
      100,
      MAX_TERMINAL_CURVATURE_DEGREES,
    ].entries()) {
      const button = createLabelButton(
        value === 0 ? 'Flat' : `${value}°`,
        0.35,
        0.12,
        actionData({ type: 'curvature', degrees: value }),
      );
      button.position.set(((index % 4) - 1.5) * 0.4, 0.08 - Math.floor(index / 4) * 0.18, 0);
      setModifierVisual(button, degrees === value, ctx.accent.hex);
      root.add(button);
    }
    for (const [index, delta] of [-5, 5].entries()) {
      const button = createLabelButton(
        delta < 0 ? 'Curve less' : 'Curve more',
        0.7,
        0.12,
        actionData({ type: 'curvatureStep', delta }),
      );
      button.position.set(index ? 0.4 : -0.4, -0.36, 0);
      root.add(button);
    }
    for (const [index, action] of (['warpCancel', 'warpDone'] as const).entries()) {
      const button = createLabelButton(
        index ? 'Done' : 'Cancel',
        0.7,
        0.12,
        actionData({ type: action }),
      );
      button.position.set(index ? 0.4 : -0.4, -0.54, 0);
      root.add(button);
    }
  },
  handleAction(action, _hit, ctx) {
    switch (action.type) {
      case 'curvature':
      case 'curvatureStep': {
        const id = ctx.mutableState.inputTargetId;
        if (id)
          ctx.setTerminalCurvature(
            id,
            action.type === 'curvature'
              ? Number(action.degrees)
              : ctx.getTerminalCurvature(id) + Number(action.delta),
            ctx.warpPanelEdit?.id !== id,
          );
        return true;
      }
      case 'warpDone':
      case 'warpCancel':
        ctx.settleWarpPanel(action.type === 'warpDone');
        ctx.hideInput();
        return true;
      default:
        return false;
    }
  },
};
