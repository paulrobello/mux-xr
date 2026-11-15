import type * as THREE from 'three';
import {
  BUTTON_FUNCTION_LABELS,
  CONTROLLER_BUTTON_LABELS,
  CONTROLLER_BUTTONS,
  type ControllerButton,
  DEFAULT_BUTTON_MAP,
  nextButtonFunction,
} from '../../workspace/controller-buttons';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const buttonsPanel: PanelModule = {
  title: () => 'Controller buttons',
  closePosition: () => ({ x: 0.22, y: -0.66 }),
  back: () => ({ target: 'settings', x: -0.22, y: -0.66 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const map = ctx.mutableState.windowPreferences.buttonMap;
    for (const [index, button] of CONTROLLER_BUTTONS.entries()) {
      const row = createLabelButton(
        `${CONTROLLER_BUTTON_LABELS[button]}: ${BUTTON_FUNCTION_LABELS[map[button]]}`,
        1.05,
        0.11,
        { inputAction: 'buttonMapNext', controllerButton: button },
      );
      row.position.set(0, 0.32 - index * 0.15, 0);
      root.add(row);
    }
    const reset = createLabelButton('Reset buttons', 0.6, 0.1, { inputAction: 'buttonMapReset' });
    reset.position.set(0, -0.32, 0);
    root.add(reset);
    const hint = createLabelButton('While warping, right A saves and right B cancels', 1.4, 0.07, {
      inputAction: 'noop',
    });
    hint.position.y = -0.46;
    root.add(hint);
  },
  handle(action, hit, ctx) {
    if (action === 'buttonMapNext') {
      const button = hit.userData.controllerButton as ControllerButton;
      const map = ctx.mutableState.windowPreferences.buttonMap;
      if (CONTROLLER_BUTTONS.includes(button))
        ctx.setWindowPreferences({
          ...ctx.mutableState.windowPreferences,
          buttonMap: { ...map, [button]: nextButtonFunction(map[button]) },
        });
      return true;
    }
    if (action === 'buttonMapReset') {
      ctx.setWindowPreferences({
        ...ctx.mutableState.windowPreferences,
        buttonMap: { ...DEFAULT_BUTTON_MAP },
      });
      return true;
    }
    return false;
  },
};
