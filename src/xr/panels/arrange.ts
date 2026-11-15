import type * as THREE from 'three';
import type { PanelArrangement } from '../../contracts';
import { ARMED_STYLE, CONFIRM_LABELS, createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const arrangePanel: PanelModule = {
  title: () => 'Arrange terminals',
  build(root: THREE.Group, ctx: SceneContext): void {
    const status = createLabelButton(
      ctx.panels.size
        ? `${ctx.panels.size} terminals · keep sizes and input target`
        : 'Open terminals first',
      1.5,
      0.1,
      { inputAction: 'noop' },
    );
    status.position.y = 0.36;
    root.add(status);
    if (ctx.panels.size) {
      const patterns: Array<[string, PanelArrangement]> = [
        ['Row', 'row'],
        ['Grid', 'grid'],
        ['Arc', 'arc'],
        ['Sphere', 'sphere'],
      ];
      patterns.forEach(([label, pattern], index) => {
        const button = createLabelButton(label, 0.65, 0.14, {
          inputAction: 'arrange',
          pattern,
        });
        button.position.set(index % 2 ? 0.38 : -0.38, 0.16 - Math.floor(index / 2) * 0.2, 0);
        setModifierVisual(button, ctx.mutableState.arrangement === pattern);
        root.add(button);
      });
      for (const [label, direction] of [
        ['Closer', -1],
        ['Farther', 1],
      ] as const) {
        const button = createLabelButton(label, 0.65, 0.11, {
          inputAction: 'layoutDepth',
          direction,
        });
        button.position.set(direction < 0 ? -0.38 : 0.38, -0.28, 0);
        root.add(button);
      }
    }
    const resetArmed = ctx.armedControl?.action === 'resetLayout';
    const reset = createLabelButton(CONFIRM_LABELS.resetLayout[resetArmed ? 1 : 0], 0.65, 0.1, {
      inputAction: 'resetLayout',
      ...(resetArmed ? ARMED_STYLE : {}),
    });
    reset.position.y = -0.45;
    root.add(reset);
  },
  handle(action, hit, ctx) {
    if (action === 'resetLayout') {
      if (!ctx.confirmControl('resetLayout')) return true;
      ctx.resetLayout();
      ctx.cue('recenter', ctx.lastSelectSource);
      return true;
    }
    if (action === 'layoutDepth') {
      ctx.moveLayoutDepth(Number(hit.userData.direction));
      return true;
    }
    if (action === 'arrange') {
      ctx.arrangeTerminals(hit.userData.pattern as PanelArrangement);
      return true;
    }
    return false;
  },
};
