import type * as THREE from 'three';
import type { TerminalFiltering, TerminalFilterMode } from '../../terminal/filtering';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const filteringPanel: PanelModule = {
  title: () => 'Terminal filtering',
  closePosition: () => ({ x: 0.22, y: -0.66 }),
  back: () => ({ target: 'display', x: -0.22, y: -0.66 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const modes: Array<[string, TerminalFilterMode]> = [
      ['Nearest', 'nearest'],
      ['Linear sharp', 'linear'],
      ['Mipmap bilinear', 'mipmap-nearest'],
      ['Mipmap smooth', 'mipmap-linear'],
    ];
    modes.forEach(([label, filterMode], index) => {
      const button = createLabelButton(label, 0.74, 0.12, {
        inputAction: 'filterMode',
        filterMode,
      });
      button.position.set(index % 2 ? 0.4 : -0.4, 0.3 - Math.floor(index / 2) * 0.16, 0);
      setModifierVisual(button, ctx.mutableState.filtering.mode === filterMode);
      root.add(button);
    });
    const mipMode = ctx.mutableState.filtering.mode.startsWith('mipmap-');
    const maximum = Number(ctx.scene.userData.maxAnisotropy ?? 1);
    if (mipMode) {
      const levels = ([1, 2, 4, 8, 16] as const).filter((value) => value <= maximum);
      levels.forEach((anisotropy, index) => {
        const button = createLabelButton(anisotropy === 1 ? 'Off' : `${anisotropy}x`, 0.26, 0.1, {
          inputAction: 'filterAnisotropy',
          anisotropy,
        });
        button.position.set((index - (levels.length - 1) / 2) * 0.3, -0.1, 0);
        setModifierVisual(button, ctx.mutableState.filtering.anisotropy === anisotropy);
        root.add(button);
      });
      const hint = createLabelButton(`Oblique smoothing · device max ${maximum}x`, 1.45, 0.055, {
        inputAction: 'noop',
      });
      hint.position.y = -0.19;
      root.add(hint);
    }
    const gaze = createLabelButton(
      `Sharper gaze: ${ctx.mutableState.filtering.gazeClarity ? 'on' : 'off'}`,
      1.2,
      0.1,
      { inputAction: 'filterGaze' },
    );
    gaze.position.y = -0.28;
    setModifierVisual(gaze, ctx.mutableState.filtering.gazeClarity);
    root.add(gaze);
    if (mipMode && ctx.mutableState.filtering.gazeClarity) {
      const distance = createLabelButton(
        `Sharpen within ${ctx.mutableState.filtering.gazeMaxDistance.toFixed(2)} m`,
        1.08,
        0.08,
        { inputAction: 'noop' },
      );
      distance.position.y = -0.42;
      root.add(distance);
      for (const [index, delta] of [-0.25, 0.25].entries()) {
        const button = createLabelButton(delta < 0 ? '−' : '+', 0.15, 0.1, {
          inputAction: 'filterDistance',
          delta,
        });
        button.position.set(index ? 0.7 : -0.7, -0.42, 0);
        root.add(button);
      }
    }
  },
  handle(action, hit, ctx) {
    if (action === 'filterDistance') {
      ctx.setTerminalFiltering({
        ...ctx.mutableState.filtering,
        gazeMaxDistance: ctx.mutableState.filtering.gazeMaxDistance + Number(hit.userData.delta),
      });
      return true;
    }
    if (action === 'filterMode' || action === 'filterAnisotropy' || action === 'filterGaze') {
      ctx.setTerminalFiltering({
        ...ctx.mutableState.filtering,
        ...(action === 'filterMode' ? { mode: hit.userData.filterMode as TerminalFilterMode } : {}),
        ...(action === 'filterAnisotropy'
          ? { anisotropy: Number(hit.userData.anisotropy) as TerminalFiltering['anisotropy'] }
          : {}),
        ...(action === 'filterGaze'
          ? { gazeClarity: !ctx.mutableState.filtering.gazeClarity }
          : {}),
      });
      return true;
    }
    return false;
  },
};
