import type * as THREE from 'three';
import { addColorSwatchRows } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const accentPanel: PanelModule = {
  title: () => 'Accent colors',
  closePosition: () => ({ x: 0.22, y: -0.2 }),
  back: () => ({ target: 'world', x: -0.22, y: -0.2 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    addColorSwatchRows(root, 0.38, [
      ['Interface accent', 'accentColor', ctx.mutableState.accentColor, 'Default'],
      [
        'Environment accent',
        'environmentAccentColor',
        ctx.mutableState.environmentAccentColor,
        'Match',
      ],
    ]);
  },
};
