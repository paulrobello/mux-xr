import type * as THREE from 'three';
import { actionData } from '../panel-actions';
import { createLabelButton } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';
import { layoutWidgetPanel } from '../widget-panel-layout';
import { getWidgetEntry, isWidgetKind, WIDGET_REGISTRY } from '../widget-registry';

export const widgetsPanel: PanelModule = {
  title: () => 'Widgets',
  onShow(ctx) {
    ctx.widgetsPage = 0;
    return false;
  },
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
        actionData({ type: 'toggleWidget', widgetKind: kind }),
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
        actionData({ type: 'noop' }),
      );
      pageLabel.position.set(caption.x, caption.y, 0);
      root.add(pageLabel);
      for (const [label, delta, rect] of [
        ['Prev', -1, prev],
        ['Next', 1, next],
      ] as const) {
        const enabled = delta < 0 ? layout.page > 0 : layout.page < layout.pages - 1;
        const button = createLabelButton(
          label,
          rect.width,
          rect.height,
          actionData({ type: enabled ? 'widgetsPage' : 'noop', delta }),
        );
        button.position.set(rect.x, rect.y, 0);
        button.visible = enabled;
        root.add(button);
      }
    }
  },
  handleActionEarly(action, _hit, ctx) {
    switch (action.type) {
      case 'widgetsPage':
        ctx.widgetsPage += Number(action.delta) || 0;
        ctx.refreshInputRoot('widgets');
        return true;
      default:
        return false;
    }
  },
  handleAction(action, _hit, ctx) {
    switch (action.type) {
      case 'toggleWidget':
        if (isWidgetKind(action.widgetKind)) ctx.toggleWidget(action.widgetKind);
        return true;
      default:
        return false;
    }
  },
};
