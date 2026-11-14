import {
  createRadialMenu as createMenu,
  type RadialMenu as ToolkitRadialMenu,
} from '@par/xr-workspace/internal/radial-menu';

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

export type RadialMenu = ToolkitRadialMenu<Action> & {
  setUpdateAvailable(available: boolean): void;
};

export function createRadialMenu(): RadialMenu {
  const menu = createMenu<Action>({
    items: [
      { id: 'keyboard', label: 'Keyboard' },
      { id: 'commands', label: 'Commands' },
      { id: 'panes', label: 'Panes' },
      { id: 'layout', label: 'Layout' },
      { id: 'warp', label: 'Warp' },
      { id: 'widgets', label: 'Widgets' },
      { id: 'settings', label: 'Settings' },
      { id: 'focus', label: 'Focus' },
    ],
    footer: {
      id: 'reloadUpdate',
      name: 'radial-menu-reload-update',
      label: 'Reload update',
      helpText: 'Exit XR and reload the available update',
    },
  });
  return Object.assign(menu, { setUpdateAvailable: menu.setFooterVisible });
}
