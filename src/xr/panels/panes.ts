import type * as THREE from 'three';
import { createHierarchyNavigator, type HierarchyNavigation } from '../hierarchy-navigator';
import type { PanelModule, SceneContext } from '../scene-context';

export const panesPanel: PanelModule = {
  title: (ctx) =>
    `Mux tree · ${ctx.mutableState.hierarchyStyle === 'helix' ? 'Helix Navigator' : 'Spatial Docks'}`,
  titleWidth: 1.8,
  titleY: 1.65,
  closePosition: () => ({ x: -1.2, y: -0.9 }),
  onPrepare(ctx) {
    ctx.initializeHierarchy();
  },
  finalize(root, ctx) {
    root.updateMatrixWorld(true);
    ctx.hierarchyNavigator?.update(
      0,
      ctx.renderer?.xr.isPresenting ? ctx.renderer.xr.getCamera() : ctx.camera,
    );
    ctx.scene.add(root);
    return true;
  },
  build(root: THREE.Group, ctx: SceneContext): void {
    for (const panel of ctx.panels.values()) {
      ctx.hierarchyHiddenPanels.set(panel.root, panel.root.visible);
      panel.root.visible = false;
    }
    const navigator = createHierarchyNavigator(
      ctx.availablePanes,
      ctx.mutableState.hierarchyStyle,
      ctx.hierarchyNavigation,
      new Set(ctx.panels.keys()),
      ctx.uiEnvironmentTexture,
      () => ctx.paneCreation,
      () => ctx.agentRoster,
      () => ctx.agentRosterRows,
    );
    ctx.hierarchyNavigator = navigator;
    const navigation: HierarchyNavigation = {
      path: navigator.root.userData.hierarchyPath as string[],
      page: navigator.root.userData.hierarchyPage as number,
    };
    ctx.hierarchyNavigation = navigation;
    root.add(navigator.root);
    navigator.root.userData.transitioning = navigator.transitioning;
  },
};
