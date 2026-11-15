import type * as THREE from 'three';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';
import { layoutWidgetPanel } from '../widget-panel-layout';
import { getWidgetEntry, isWidgetKind, WIDGET_REGISTRY } from '../widget-registry';

export const widgetsPanel: PanelModule = {
  title: () => 'Widgets',
  closePosition: (ctx) => {
    const { x, y } = layoutWidgetPanel(WIDGET_REGISTRY.length, ctx.widgetsPage).close;
    return { x, y };
  },
  build(root: THREE.Group, ctx: SceneContext): void {
    const layout = layoutWidgetPanel(WIDGET_REGISTRY.length, ctx.widgetsPage);
    ctx.widgetsPage = layout.page;
    layout.buttons.forEach((rect, index) => {
      const { kind, displayName } = WIDGET_REGISTRY[layout.first + index];
      const button = createLabelButton(
        (ctx.widgets.has(kind) && !getWidgetEntry(kind).multiInstance ? 'Hide ' : 'Add ') +
          displayName,
        rect.width,
        rect.height,
        { inputAction: 'toggleWidget', widgetKind: kind },
      );
      button.position.set(rect.x, rect.y, 0);
      root.add(button);
    });
    if (layout.pager) {
      const { prev, caption, next } = layout.pager;
      const pageLabel = createLabelButton(
        `${layout.page + 1} / ${layout.pages}`,
        caption.width,
        caption.height,
        { inputAction: 'noop' },
      );
      pageLabel.position.set(caption.x, caption.y, 0);
      root.add(pageLabel);
      for (const [label, delta, rect] of [
        ['Prev', -1, prev],
        ['Next', 1, next],
      ] as const) {
        const enabled = delta < 0 ? layout.page > 0 : layout.page < layout.pages - 1;
        const button = createLabelButton(label, rect.width, rect.height, {
          inputAction: enabled ? 'widgetsPage' : 'noop',
          delta,
        });
        button.position.set(rect.x, rect.y, 0);
        button.visible = enabled;
        root.add(button);
      }
    }
  },
  handleEarly(action, hit, ctx) {
    if (action === 'widgetsPage') {
      ctx.widgetsPage += Number(hit.userData.delta) || 0;
      ctx.refreshInputRoot('widgets');
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action === 'toggleWidget') {
      if (isWidgetKind(hit.userData.widgetKind)) ctx.toggleWidget(hit.userData.widgetKind);
      return true;
    }
    return false;
  },
};
