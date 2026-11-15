import * as THREE from 'three';
import { actionData, setAction } from '../panel-actions';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';
import { addPicturePanelMessage } from './picture-url';

const RECENT_PAGE_SIZE = 6;

export const pictureGalleryPanel: PanelModule = {
  title: () => 'Recent pictures',
  closePosition: () => ({ x: 0.3, y: -0.46 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const entries = ctx.recentPictures;
    if (!Array.isArray(entries) || entries.length === 0) {
      const status = createLabelButton(
        entries === 'loading'
          ? 'Loading…'
          : entries === null
            ? 'Recent pictures need browser storage'
            : 'No recent pictures yet',
        1.3,
        0.1,
        actionData({ type: 'noop' }),
      );
      status.name = 'xr-recent-status';
      status.position.y = 0.1;
      root.add(status);
    } else {
      const pages = Math.ceil(entries.length / RECENT_PAGE_SIZE);
      ctx.recentPage = Math.max(0, Math.min(pages - 1, ctx.recentPage));
      const first = ctx.recentPage * RECENT_PAGE_SIZE;
      entries.slice(first, first + RECENT_PAGE_SIZE).forEach((entry, index) => {
        // Tiles are 0.4 x 0.28 panel units (15 x 11 cm at the 0.38 spawn scale), 0.07 and 0.06 apart.
        const x = ((index % 3) - 1) * 0.47;
        const y = 0.28 - Math.floor(index / 3) * 0.36;
        const { width, height, source } = entry.thumbnail;
        const fit = Math.min(0.4 / width, 0.28 / height);
        const texture = new THREE.CanvasTexture(source);
        texture.colorSpace = THREE.SRGBColorSpace;
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(width * fit, height * fit),
          new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
        );
        tile.name = 'xr-recent-thumbnail';
        setAction(tile, { type: 'pictureRecentPlace', recentId: entry.id });
        tile.userData.helpText = `Put ${entry.name} in the frame`;
        tile.position.set(x, y, 0);
        const remove = createLabelButton(
          '×',
          0.12,
          0.12,
          actionData({ type: 'pictureRecentRemove', recentId: entry.id }),
        );
        remove.name = 'xr-recent-remove';
        remove.userData.helpText = `Remove ${entry.name} from Recent`;
        // Centred on the thumbnail's top-right corner: pinch-sized (0.12 is 46 mm) while covering
        // only 0.06 of the thumbnail's width, under a third of a 3:4 portrait.
        remove.position.set(x + (width * fit) / 2, y + (height * fit) / 2, 0.01);
        root.add(tile, remove);
      });
      if (pages > 1) {
        const caption = createLabelButton(
          `${ctx.recentPage + 1} / ${pages}`,
          0.3,
          0.09,
          actionData({ type: 'noop' }),
        );
        caption.position.y = -0.3;
        root.add(caption);
        for (const [label, delta, x] of [
          ['Prev', -1, -0.5],
          ['Next', 1, 0.5],
        ] as const) {
          const enabled = delta < 0 ? ctx.recentPage > 0 : ctx.recentPage < pages - 1;
          const page = createLabelButton(
            label,
            0.34,
            0.12,
            actionData(enabled ? { type: 'pictureRecentPage', delta } : { type: 'noop' }, {
              delta,
            }),
          );
          page.position.set(x, -0.3, 0);
          root.add(page);
        }
      }
    }
    const enterUrl = createLabelButton('Enter URL', 0.5, 0.12, actionData({ type: 'pictureUrl' }));
    // Shares the bottom row with Close, keeping the panel short and clear of the HUD bar.
    enterUrl.position.set(-0.3, -0.46, 0);
    root.add(enterUrl);
    addPicturePanelMessage(root, ctx, -0.6);
  },
};
