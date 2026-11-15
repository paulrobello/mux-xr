import * as THREE from 'three';
import type { BackgroundMode } from '../../contracts';
import { accent } from '../accent-state';
import {
  BACKGROUND_LABELS,
  BACKGROUND_TILE_HEIGHT,
  BACKGROUND_TILE_WIDTH,
  layoutBackgroundPicker,
} from '../background-picker';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const backgroundsPanel: PanelModule = {
  title: () => 'Backgrounds',
  closePosition: () => ({ x: 0.3, y: -0.46 }),
  back: () => ({ target: 'world', x: -0.3, y: -0.46 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const layout = layoutBackgroundPicker(ctx.backgroundRow);
    ctx.backgroundRow = layout.firstRow;
    for (const { mode: background, x, y } of layout.tiles) {
      const selected = background === ctx.mutableState.background;
      const label = BACKGROUND_LABELS[background];
      const thumbnail = ctx.backgroundThumbnail(background);
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(BACKGROUND_TILE_WIDTH, BACKGROUND_TILE_HEIGHT),
        new THREE.MeshBasicMaterial({
          map: thumbnail,
          color: thumbnail ? 0xffffff : 0x16222c,
          toneMapped: false,
        }),
      );
      tile.name = 'xr-background-thumbnail';
      // Not 'background': setBackground tints that action's meshes, which would tint the picture.
      Object.assign(tile.userData, {
        inputAction: 'backgroundTile',
        background,
        helpText: label,
      });
      tile.position.set(x, y, 0);
      root.add(tile);
      if (selected) {
        const frame = new THREE.Mesh(
          new THREE.PlaneGeometry(BACKGROUND_TILE_WIDTH + 0.024, BACKGROUND_TILE_HEIGHT + 0.024),
          new THREE.MeshBasicMaterial({ color: accent.hex }),
        );
        frame.name = 'xr-background-selected';
        frame.userData.inputAction = 'noop';
        frame.position.set(x, y, -0.004);
        root.add(frame);
      }
      const caption = createLabelButton(label, BACKGROUND_TILE_WIDTH, 0.07, {
        inputAction: 'background',
        background,
      });
      caption.position.set(x, y - BACKGROUND_TILE_HEIGHT / 2 - 0.05, 0);
      setModifierVisual(caption, selected);
      root.add(caption);
    }
    for (const [glyph, delta, y, enabled] of [
      ['▲', -1, 0.26, layout.canScrollUp],
      ['▼', 1, -0.14, layout.canScrollDown],
    ] as const) {
      const button = createLabelButton(glyph, 0.12, 0.2, {
        inputAction: enabled ? 'backgroundScroll' : 'noop',
        delta,
      });
      button.name = delta < 0 ? 'xr-background-scroll-up' : 'xr-background-scroll-down';
      button.userData.helpText = delta < 0 ? 'Scroll up' : 'Scroll down';
      button.position.set(0.82, y, 0);
      button.visible = enabled;
      root.add(button);
    }
    const rows = createLabelButton(layout.caption, 0.26, 0.06, { inputAction: 'noop' });
    rows.name = 'xr-background-rows';
    rows.position.set(0.86, 0.06, 0);
    root.add(rows);
  },
  handleEarly(action, hit, ctx) {
    if (action === 'backgroundScroll') {
      ctx.backgroundRow = layoutBackgroundPicker(
        ctx.backgroundRow + (Number(hit.userData.delta) || 0),
      ).firstRow;
      if (ctx.inputRoot && ctx.inputMode === 'backgrounds') ctx.refreshInputRoot('backgrounds');
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action === 'background' || action === 'backgroundTile') {
      ctx.setBackground(hit.userData.background as BackgroundMode);
      return true;
    }
    return false;
  },
};
