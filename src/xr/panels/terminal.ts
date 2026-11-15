import * as THREE from 'three';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const terminalPanel: PanelModule = {
  title: (ctx) =>
    `Terminal settings · ${
      ctx.mutableState.inputTargetTitle
        ? `Target: ${ctx.mutableState.inputTargetTitle}`
        : 'No target selected'
    }`,
  closePosition: (ctx) => ({
    x: 0.22,
    y:
      ctx.mutableState.inputTargetId && ctx.panels.has(ctx.mutableState.inputTargetId)
        ? -0.78
        : -0.66,
  }),
  back: (ctx) => ({
    target: 'settings',
    x: -0.22,
    y:
      ctx.mutableState.inputTargetId && ctx.panels.has(ctx.mutableState.inputTargetId)
        ? -0.78
        : -0.66,
  }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const target = ctx.mutableState.inputTargetId;
    const surface = target ? ctx.panels.get(target)?.surface : undefined;
    if (surface && target) {
      if (ctx.gridDraft?.target !== target)
        ctx.gridDraft = { target, cols: surface.cols, rows: surface.rows };
      const status = createLabelButton(`${surface.cols} × ${surface.rows}`, 0.9, 0.1, {
        inputAction: 'noop',
      });
      status.name = 'terminal-grid-status';
      status.position.y = 0.4;
      root.add(status);
      (
        [
          [80, 24],
          [100, 30],
          [120, 36],
          [160, 48],
        ] as const
      ).forEach(([cols, rows], index) => {
        const button = createLabelButton(`${cols}×${rows}`, 0.34, 0.09, {
          inputAction: 'gridPreset',
          cols,
          rows,
        });
        button.position.set((index - 1.5) * 0.39, 0.25, 0);
        root.add(button);
      });
      for (const [axis, y] of [
        ['cols', 0.1],
        ['rows', -0.04],
      ] as const) {
        const draft = ctx.gridDraft;
        const caption = createLabelButton(
          `${axis === 'cols' ? 'Cols' : 'Rows'}: ${draft ? draft[axis] : 0}`,
          0.35,
          0.09,
          { inputAction: 'noop' },
        );
        caption.position.set(0, y, 0);
        root.add(caption);
        [-10, -1, 1, 10].forEach((delta, index) => {
          const button = createLabelButton(delta > 0 ? `+${delta}` : String(delta), 0.25, 0.09, {
            inputAction: 'gridStep',
            axis,
            delta,
          });
          button.position.set([-0.72, -0.4, 0.4, 0.72][index], y, 0);
          root.add(button);
        });
      }
      const apply = createLabelButton(ctx.gridRequestStatus || 'Apply grid', 0.9, 0.09, {
        inputAction: 'gridApply',
      });
      apply.position.y = -0.2;
      root.add(apply);
    }
    if (target && surface) {
      const panel = ctx.panels.get(target);
      const zoom = Number(panel?.root.userData.fontZoom ?? 1);
      const textSize = createLabelButton(`Text zoom: ${Math.round(zoom * 100)}%`, 1.05, 0.08, {
        inputAction: 'noop',
      });
      textSize.position.y = -0.34;
      root.add(textSize);
      for (const direction of [-1, 1]) {
        const button = createLabelButton(direction < 0 ? '−' : '+', 0.15, 0.09, {
          inputAction: 'fontZoom',
          terminalId: target,
          direction,
        });
        button.position.set(direction * 0.7, -0.34, 0);
        root.add(button);
      }
      const opacity = ctx.getTerminalOpacity(target);
      const glass = createLabelButton(`Glass opacity: ${Math.round(opacity * 100)}%`, 1.1, 0.08, {
        inputAction: 'noop',
      });
      glass.position.y = -0.48;
      root.add(glass);
      for (const [index, delta] of [-0.1, 0.1].entries()) {
        const button = createLabelButton(delta < 0 ? '−' : '+', 0.15, 0.09, {
          inputAction: 'glassOpacity',
          delta,
        });
        button.position.set(index ? 0.7 : -0.7, -0.48, 0);
        root.add(button);
      }
      const reset = createLabelButton('Reset to defaults', 1.1, 0.09, {
        inputAction: 'resetTerminalAppearance',
      });
      reset.position.y = -0.62;
      root.add(reset);
    }
  },
  handle(action, hit, ctx) {
    if (action === 'resetTerminalAppearance') {
      const id = ctx.mutableState.inputTargetId;
      if (id) ctx.resetTerminalAppearance(id);
      return true;
    }
    if (action === 'glassOpacity') {
      const id = ctx.mutableState.inputTargetId;
      if (id) ctx.setTerminalOpacity(id, ctx.getTerminalOpacity(id) + Number(hit.userData.delta));
      return true;
    }
    if (action === 'gridPreset' || action === 'gridStep') {
      const draft = ctx.gridDraft;
      if (!draft) return true;
      if (action === 'gridPreset') {
        draft.cols = Number(hit.userData.cols);
        draft.rows = Number(hit.userData.rows);
      } else {
        const axis = hit.userData.axis as 'cols' | 'rows';
        draft[axis] = THREE.MathUtils.clamp(
          draft[axis] + Number(hit.userData.delta),
          2,
          axis === 'cols' ? 300 : 150,
        );
      }
      ctx.gridRequestStatus = '';
      ctx.refreshInputRoot('terminal');
      return true;
    }
    if (action === 'gridApply') {
      const draft = ctx.gridDraft;
      if (draft)
        ctx.gridRequestStatus = ctx.actions.resizeGrid?.(draft.target, draft.cols, draft.rows)
          ? 'Grid requested'
          : 'Grid unavailable';
      ctx.refreshInputRoot('terminal');
      return true;
    }
    if (action === 'fontZoom') {
      const panel = ctx.panels.get(
        String(hit.userData.terminalId ?? ctx.mutableState.inputTargetId ?? ''),
      );
      if (panel) {
        const next = Math.max(
          1,
          Math.min(
            1.8,
            ((panel.root.userData.fontZoom as number) ?? 1) +
              (hit.userData.direction as number) * 0.1,
          ),
        );
        panel.root.userData.fontZoom = next;
        panel.texture.wrapS = THREE.ClampToEdgeWrapping;
        panel.texture.wrapT = THREE.ClampToEdgeWrapping;
        panel.texture.repeat.set(1 / next, 1 / next);
        panel.texture.offset.set(0, 0);
        panel.texture.needsUpdate = true;
        if (ctx.inputRoot && ctx.inputMode === 'terminal') ctx.refreshInputRoot('terminal');
      }
      return true;
    }
    return false;
  },
};
