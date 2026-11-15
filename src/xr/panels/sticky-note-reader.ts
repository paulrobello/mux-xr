import { createScalableLabel } from '@par/xr-workspace';
import * as THREE from 'three';
import { actionData } from '../panel-actions';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const stickyNoteReaderPanel: PanelModule = {
  title: (ctx) => `Sticky note  ${ctx.notePage + 1} / ${ctx.notePages.length}`,
  build(root: THREE.Group, ctx: SceneContext): void {
    const text = createScalableLabel(ctx.notePages[ctx.notePage] ?? '', 1.72, 0.79, {
      background: '#17212d',
      align: 'left',
      fontSize: 0.048,
    });
    text.name = 'sticky-note-page';
    text.position.y = 0.05;
    root.add(text);
    for (const direction of [-1, 1]) {
      if (ctx.notePage + direction < 0 || ctx.notePage + direction >= ctx.notePages.length)
        continue;
      const button = createLabelButton(
        direction < 0 ? 'Previous' : 'Next',
        0.36,
        0.1,
        actionData({ type: 'stickyNotePage', delta: direction }),
      );
      button.position.set(direction * 0.4, -0.52, 0);
      root.add(button);
    }
  },
  handleAction(action, _hit, ctx) {
    switch (action.type) {
      case 'stickyNotePage': {
        ctx.notePage = THREE.MathUtils.clamp(
          ctx.notePage + Number(action.delta),
          0,
          ctx.notePages.length - 1,
        );
        ctx.refreshInputRoot('sticky-note-reader');
        return true;
      }
      default:
        return false;
    }
  },
};
