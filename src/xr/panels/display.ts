import type * as THREE from 'three';
import type { TerminalColorMode } from '../../contracts';
import { validateHierarchyStyle } from '../../workspace/hierarchy-style';
import { SCROLL_STRIP_SIDES, type ScrollStripSide } from '../../workspace/window-preferences';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const displayPanel: PanelModule = {
  title: () => 'Display settings',
  closePosition: () => ({ x: 0.22, y: -0.855 }),
  back: () => ({ target: 'settings', x: -0.22, y: -0.855 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const state = ctx.mutableState;
    (
      [
        ['Comfort', 'comfort'],
        ['Original', 'original'],
        ['Mono', 'monochrome'],
      ] as const
    ).forEach(([label, colorMode], index) => {
      const button = createLabelButton(label, 0.4, 0.12, {
        inputAction: 'terminalColors',
        colorMode,
      });
      button.position.set((index - 1) * 0.46, 0.4, 0);
      setModifierVisual(button, state.terminalColorMode === colorMode);
      root.add(button);
    });
    const filteringButton = createLabelButton('Filtering and gaze clarity', 1.3, 0.12, {
      inputAction: 'openInput',
      mode: 'filtering',
    });
    filteringButton.position.y = 0.25;
    root.add(filteringButton);
    const hierarchyStyle = createLabelButton(
      `Mux tree: ${state.hierarchyStyle === 'helix' ? 'Helix Navigator' : 'Spatial Docks'}`,
      1.45,
      0.11,
      {
        inputAction: 'hierarchyStyle',
        hierarchyStyle: state.hierarchyStyle === 'helix' ? 'spatial-docks' : 'helix',
      },
    );
    hierarchyStyle.position.y = 0.1;
    root.add(hierarchyStyle);
    const preferences = state.windowPreferences;
    for (const [index, [preference, label, step]] of (
      [
        [
          'defaultOpacity',
          `New window glass: ${Math.round(preferences.defaultOpacity * 100)}%`,
          0.1,
        ],
        ['defaultCurvature', `New window warp: ${Math.round(preferences.defaultCurvature)}°`, 5],
        ['focusDistance', `Focus distance: ${preferences.focusDistance.toFixed(1)} m`, 0.1],
        ['focusCurvature', `Focus warp angle: ${Math.round(preferences.focusCurvature)}°`, 5],
      ] as const
    ).entries()) {
      if (preference === 'focusCurvature' && preferences.focusWarpMode === 'inherit') continue;
      const y = -0.04 - index * 0.115;
      const value = createLabelButton(label, 1.05, 0.1, { inputAction: 'noop' });
      value.position.set(0, y, 0);
      root.add(value);
      for (const direction of [-1, 1]) {
        const button = createLabelButton(direction < 0 ? '−' : '+', 0.12, 0.1, {
          inputAction: 'windowPreference',
          preference,
          delta: direction * step,
        });
        button.position.set(direction * 0.65, y, 0);
        root.add(button);
      }
    }
    const focusWarpModeButton = createLabelButton(
      preferences.focusWarpMode === 'inherit'
        ? 'Focus warp: Inherit from terminal'
        : 'Focus warp: Custom',
      1.3,
      0.1,
      { inputAction: 'focusWarpMode' },
    );
    focusWarpModeButton.position.y = -0.5;
    root.add(focusWarpModeButton);
    const stripSide = preferences.scrollStripSide;
    const stripSideButton = createLabelButton(
      `Scroll strip: ${stripSide === 'both' ? 'both sides' : stripSide}`,
      1.05,
      0.1,
      {
        inputAction: 'scrollStripSide',
        scrollStripSide:
          SCROLL_STRIP_SIDES[
            (SCROLL_STRIP_SIDES.indexOf(stripSide) + 1) % SCROLL_STRIP_SIDES.length
          ],
      },
    );
    stripSideButton.position.set(0, -0.615, 0);
    root.add(stripSideButton);
    const frameChinButton = createLabelButton(
      `Frame chin: ${preferences.frameChin ? 'on' : 'off'}`,
      1.05,
      0.1,
      { inputAction: 'frameChin' },
    );
    frameChinButton.position.set(0, -0.73, 0);
    root.add(frameChinButton);
  },
  handleEarly(action, hit, ctx) {
    if (action === 'hierarchyStyle') {
      ctx.setHierarchyStyle(validateHierarchyStyle(hit.userData.hierarchyStyle));
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action === 'windowPreference') {
      const preference = hit.userData.preference as
        | 'defaultOpacity'
        | 'defaultCurvature'
        | 'focusDistance'
        | 'focusCurvature';
      if (
        ['defaultOpacity', 'defaultCurvature', 'focusDistance', 'focusCurvature'].includes(
          preference,
        )
      )
        ctx.setWindowPreferences({
          ...ctx.mutableState.windowPreferences,
          [preference]: ctx.mutableState.windowPreferences[preference] + Number(hit.userData.delta),
        });
      return true;
    }
    if (action === 'focusWarpMode') {
      const preferences = ctx.mutableState.windowPreferences;
      ctx.setWindowPreferences({
        ...preferences,
        focusWarpMode: preferences.focusWarpMode === 'custom' ? 'inherit' : 'custom',
      });
      return true;
    }
    if (action === 'scrollStripSide') {
      ctx.setWindowPreferences({
        ...ctx.mutableState.windowPreferences,
        scrollStripSide: hit.userData.scrollStripSide as ScrollStripSide,
      });
      return true;
    }
    if (action === 'frameChin') {
      ctx.setWindowPreferences({
        ...ctx.mutableState.windowPreferences,
        frameChin: !ctx.mutableState.windowPreferences.frameChin,
      });
      return true;
    }
    if (action === 'terminalColors') {
      const mode = hit.userData.colorMode as TerminalColorMode;
      ctx.actions.setTerminalColorMode?.(mode);
      ctx.setTerminalColorMode(mode);
      return true;
    }
    return false;
  },
};
