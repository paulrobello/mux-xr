/// <reference path="./troika-three-text.d.ts" />

export type { WorkspaceColors } from './accent-colors';
export { installBatchedHandPoses } from './batched-hand-poses';
export { type CartoonHand, createCartoonHand } from './cartoon-hand';
export { type ClockKind, createClockWidget } from './clock-widget';
export {
  createEnvironmentController,
  ENVIRONMENT_FACTORIES as BUILT_IN_ENVIRONMENTS,
  type EnvironmentController,
  type EnvironmentFactories,
  type EnvironmentFactory,
  type EnvironmentInstance,
  type EnvironmentSelection,
} from './environment';
export { createHandContact, type HandContact, type HandContactProbe } from './hand-contact';
export { type HandInputState, updateHandInput } from './hand-input';
export { type KeyModifiers, keyboardKeyLabel } from './keyboard';
export { createKeyborbInput } from './keyborb-input';
export { configureLabelFonts, createScalableLabel, disposeScalableLabel } from './labels';
export {
  createRadialMenu,
  type RadialMenu,
  type RadialMenuItem,
  type RadialMenuOptions,
} from './radial-menu';
export {
  createSpatialKeyboard,
  type KeyboardStyle,
  type SpatialKeyboard,
  type SpatialKeyboardOptions,
} from './spatial-keyboard';
export { createStandardHand, type StandardHand, type StandardHandOptions } from './standard-hand';
export { createTimerWidget } from './timer-widget';
export type { SpatialWidget } from './widget';
export { createWristMenuWatch, type WristMenuWatch } from './wrist-menu-watch';
