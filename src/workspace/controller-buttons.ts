/** Remappable controller face buttons. Triggers, grips and stick clicks stay fixed. */
export type ControllerButton = 'rightA' | 'rightB' | 'leftX' | 'leftY';

export type ButtonFunction =
  | 'menu'
  | 'panes'
  | 'focus'
  | 'keyboard'
  | 'commands'
  | 'layout'
  | 'warp'
  | 'widgets'
  | 'settings'
  | 'none';

export type ButtonMap = Record<ControllerButton, ButtonFunction>;

export const CONTROLLER_BUTTONS: readonly ControllerButton[] = [
  'rightA',
  'rightB',
  'leftX',
  'leftY',
];

export const CONTROLLER_BUTTON_LABELS: Record<ControllerButton, string> = {
  rightA: 'Right A',
  rightB: 'Right B',
  leftX: 'Left X',
  leftY: 'Left Y',
};

export const BUTTON_FUNCTIONS: readonly ButtonFunction[] = [
  'menu',
  'panes',
  'focus',
  'keyboard',
  'commands',
  'layout',
  'warp',
  'widgets',
  'settings',
  'none',
];

export const BUTTON_FUNCTION_LABELS: Record<ButtonFunction, string> = {
  menu: 'Menu',
  panes: 'Panes',
  focus: 'Focus',
  keyboard: 'Keyboard',
  commands: 'Commands',
  layout: 'Layout',
  warp: 'Warp',
  widgets: 'Widgets',
  settings: 'Settings',
  none: 'Nothing',
};

export const DEFAULT_BUTTON_MAP: ButtonMap = {
  rightA: 'menu',
  rightB: 'focus',
  leftX: 'panes',
  leftY: 'none',
};

export function validateButtonMap(value: unknown): ButtonMap {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<ControllerButton, unknown>
  >;
  const map = { ...DEFAULT_BUTTON_MAP };
  for (const button of CONTROLLER_BUTTONS) {
    const choice = candidate[button];
    if (BUTTON_FUNCTIONS.includes(choice as ButtonFunction)) map[button] = choice as ButtonFunction;
  }
  return map;
}

/** The function after `current` in menu order, wrapping to the first. */
export function nextButtonFunction(current: ButtonFunction): ButtonFunction {
  return BUTTON_FUNCTIONS[(BUTTON_FUNCTIONS.indexOf(current) + 1) % BUTTON_FUNCTIONS.length];
}
