import {
  createRadialMenu as createMenu,
  type RadialMenu as ToolkitRadialMenu,
} from '@par/xr-workspace';

export type RadialMenuAction =
  | 'keyboard'
  | 'commands'
  | 'panes'
  | 'layout'
  | 'warp'
  | 'widgets'
  | 'settings'
  | 'focus'
  | 'cancel';
export type RadialAction = RadialMenuAction;

type Action = Exclude<RadialMenuAction, 'cancel'>;

/** The menu's wedges in their clockwise-from-top order, shared with stick-angle navigation. */
export const RADIAL_ITEMS: readonly Action[] = [
  'keyboard',
  'commands',
  'panes',
  'layout',
  'warp',
  'widgets',
  'settings',
  'focus',
];

export type RadialMenu = ToolkitRadialMenu<Action> & {
  setUpdateAvailable(available: boolean): void;
};

export function createRadialMenu(): RadialMenu {
  const menu = createMenu<Action>({
    items: RADIAL_ITEMS.map((id) => ({
      id,
      label: (
        {
          keyboard: 'Keyboard',
          commands: 'Commands',
          panes: 'Panes',
          layout: 'Layout',
          warp: 'Warp',
          widgets: 'Widgets',
          settings: 'Settings',
          focus: 'Focus',
        } as Record<Action, string>
      )[id],
    })),
    footer: {
      id: 'reloadUpdate',
      name: 'radial-menu-reload-update',
      label: 'Reload update',
      helpText: 'Exit XR and reload the available update',
    },
  });
  return Object.assign(menu, { setUpdateAvailable: menu.setFooterVisible });
}
