/// <reference path="./troika-three-text.d.ts" />

export {
  accentColorOrNull,
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_HOVER,
  linearLuminance,
  resolveAccent,
  resolveAccentCss,
  resolveAccentHover,
  resolveEnvironmentAccent,
  retintAccentMaterials,
  tagAccentMaterial,
  tintToLuminance,
  type WorkspaceColors,
} from './accent-colors';
export { installBatchedHandPoses } from './batched-hand-poses';
export {
  type CartoonHand,
  type CartoonHandOptions,
  createCartoonHand,
  type HandSurfaceTheme,
  type HandTheme,
} from './cartoon-hand';
export { type ClockKind, createClockWidget } from './clock-widget';
export { controlIdOf, findControl, setControlId } from './control-ids';
export {
  type CurvedSurfaceOptions,
  type CurvedSurfaceSpan,
  clampSurfaceCurvatureRadians,
  createCurvedSurfaceGeometry,
  curvedSurfacePoint,
  MAX_SURFACE_CURVATURE_RADIANS,
  validateSpan,
} from './curved-surface';
export {
  type ArmNearFade,
  applyArmNearFade,
  createElasticArm,
  DEFAULT_ARM_NEAR_FADE,
  ELASTIC_ARM_RENDER_ORDER,
  type ElasticArm,
} from './elastic-arm';
export {
  createEnvironmentController,
  createFrameUpdaters,
  ENVIRONMENT_LOADERS,
  type EnvironmentController,
  type EnvironmentFactories,
  type EnvironmentFactory,
  type EnvironmentInstance,
  type EnvironmentSelection,
  type EnvironmentSource,
  type EnvironmentSources,
  type FrameUpdaters,
  type LazyEnvironment,
} from './environment';
export {
  ENVIRONMENT_FACTORIES,
  ENVIRONMENT_FACTORIES as BUILT_IN_ENVIRONMENTS,
} from './environment-factories';
export * from './environments/aurora-tundra';
export * from './environments/cloud-summit';
export * from './environments/deep-water';
export * from './environments/desert-night';
export * from './environments/hangar-deck';
export * from './environments/koi-garden';
export * from './environments/minimal-studio';
export * from './environments/rain-rooftop';
export {
  isMainLabelCodePoint,
  isSupportedLabelCodePoint,
  LABEL_FONT_RANGES,
  LABEL_SYMBOL_FONT_RANGES,
} from './glyph-ranges';
export {
  dimHandColor,
  HAND_BRIGHTNESS,
  HAND_COLOR_PRESETS,
  validateHandColor,
} from './hand-colors';
export {
  createHandContact,
  type HandContact,
  type HandContactProbe,
  type HandContactSample,
} from './hand-contact';
export { type HandInputResult, type HandInputState, updateHandInput } from './hand-input';
export { createHandMenuGesture, type HandMenuGesture } from './hand-menu-gesture';
export {
  createModifierState,
  keyboardDimensions,
  keyboardKeys,
  type ModifierState,
  type PositionedKey,
  type SemanticKey,
  semanticKeyboardLayout,
} from './keyboard';
export {
  createCurvedButtonSides,
  createRaisedButtonWalls,
  curveKeyboardContent,
} from './keyboard-surface';
export type {
  KeyboardModifier,
  KeyModifiers,
} from './keyboard-types';
export { keyboardKeyLabel } from './keyboard-types';
export {
  createKeyborbGlyphs,
  createKeyborbKey,
  createKeyborbShells,
  KeyborbGlyphBatch,
  type KeyborbGlyphs,
  type KeyborbShells,
  setKeyborbPressed,
} from './keyborb';
export {
  createKeyborbInput,
  type KeyborbPinchSample,
  NEAR_ENTER,
  NEAR_EXIT,
  PINCH_CLOSE,
  PINCH_OPEN,
} from './keyborb-input';
export {
  configureLabelFonts,
  createScalableLabel,
  disposeScalableLabel,
  LABEL_BEVEL_HIGHLIGHT,
  LABEL_BEVEL_ROWS,
  LABEL_BEVEL_SHADOW,
  LABEL_FONT_URL,
  LABEL_SYMBOL_FONT_URL,
  type LabelFonts,
  liveScalableLabels,
  type ScalableLabelOptions,
  updateScalableLabel,
  waitForLabelSync,
} from './labels';
export {
  createMenuPanel,
  type MenuCell,
  type MenuPanel,
  type MenuPanelOptions,
  type MenuRow,
} from './menu-panel';
export { keepAbove, OVERLAY_RENDER_ORDER } from './overlay-order';
export {
  countsAsFrame,
  createFrameTimeHistory,
  createPerfGaugeWidget,
  type FrameTimeHistory,
  formatFps,
  formatPanes,
  formatWorstFrame,
  fpsTone,
  frameTone,
  PERF_GAUGE_HEIGHT,
  PERF_GAUGE_WIDTH,
  PERF_HISTORY,
  PERF_PAUSE_MS,
  PERF_TONE_COLORS,
  type PerfGaugeOptions,
  type PerfGaugeWidget,
  type PerfSample,
  type PerfTone,
  sparklineHeights,
} from './perf-gauge';
export {
  DEFAULT_DEPTH_VIEW,
  DEPTH_REFERENCE_EDGE,
  DEPTH_STRENGTH_STEP,
  depthDisplacement,
  depthStrengthLabel,
  MAX_DEPTH_STRENGTH,
  MIN_DEPTH_STRENGTH,
  normalizeDepthView,
  type PictureDepthEdges,
  type PictureDepthMode,
  type PictureDepthSource,
  type PictureDepthView,
  stepDepthStrength,
  usesDepthMap,
} from './picture-depth';
export {
  createPictureFrameWidget,
  PICTURE_KIND,
  PICTURE_PLACEHOLDER_TEXT,
  type PictureCanvas,
  type PictureFrameImage,
  type PictureFrameOptions,
  type PictureFrameWidget,
  type PicturePickerAction,
} from './picture-frame';
export { frameSize, PICTURE_LONG_EDGE, PLACEHOLDER_ASPECT, type Size } from './picture-sizing';
export { PlacementRays, type PlacementRayTarget } from './placement-ray';
export {
  type AxisRepeat,
  type ButtonEdges,
  createAxisRepeat,
  createButtonEdges,
  createPointer,
  type Pointer,
  type PointerHit,
} from './pointer';
export {
  createRadialMenu,
  type RadialMenu,
  type RadialMenuItem,
  type RadialMenuOptions,
  type RadialMenuTheme,
} from './radial-menu';
export {
  createStickRadialNavigation,
  type StickInput,
  type StickRadialNavigation,
  type StickRadialNavigationOptions,
  wedgeIndexFromStick,
} from './radial-stick-navigation';
export { ON_TOP_LAYER } from './render-layers';
export { createSpaceBackground, type SpaceBackground } from './space-background';
export {
  addKeyboardKeys,
  addKeyborbBatches,
  createSpatialKeyboard,
  KEYBOARD_UNIT,
  type KeyboardStyle,
  type SpatialKeyboard,
  type SpatialKeyboardOptions,
} from './spatial-keyboard';
export {
  createStandardHand,
  fitWristCap,
  STANDARD_HAND_ASSET_URLS,
  STANDARD_HAND_JOINTS,
  type StandardHand,
  type StandardHandOptions,
  type WristCapFit,
} from './standard-hand';
export { estimateDisparity, measureStereoCanvases, type StereoDisparity } from './stereo-disparity';
export {
  createStickyNoteWidget,
  STICKY_NOTE_CONFIRM_MS,
  STICKY_NOTE_HEIGHT,
  STICKY_NOTE_KIND,
  STICKY_NOTE_WIDTH,
  type StickyNoteOptions,
  stickyNotePages,
} from './sticky-note';
export { CachedTextBatch } from './text-batch';
export {
  type ClockState,
  COUNTDOWN_PRESET_MINUTES,
  createTimerState,
  DEFAULT_COUNTDOWN_MS,
  DONE_FLASH_MS,
  displayMs,
  displaySeconds,
  doneAtMs,
  flashActive,
  formatSeconds,
  readout,
  reset,
  selectPreset,
  setMode,
  statusAt,
  type TimerMode,
  type TimerReadout,
  type TimerState,
  type TimerStatus,
  tick,
  toggleMode,
  toggleRun,
} from './timer-state';
export { createTimerWidget, TIMER_HEIGHT, TIMER_WIDTH } from './timer-widget';
export {
  applyUIEnvironment,
  createUIEnvironment,
  isSharedUIEnvironment,
  UI_ENV_MAP_INTENSITY,
  type UIEnvironment,
} from './ui-environment';
/**
 * Dependency-free weather model and provider, re-exported for browser callers that must not load
 * three.js. The dedicated subpaths (`@par/xr-workspace/weather`) stay the canonical import.
 */
export type {
  WeatherDay,
  WeatherFailure,
  WeatherFetcher,
  WeatherNow,
  WeatherReport,
  WeatherResult,
  WeatherStatus,
} from './weather-data';
export { validateWeatherZip, WEATHER_ZIP_FORMAT } from './weather-data';
export { createDirectWeatherFetcher } from './weather-provider';
export {
  createWeatherWidget,
  formatDayTemps,
  formatUpdated,
  WEATHER_HEIGHT,
  WEATHER_KIND,
  WEATHER_POLL_MS,
  WEATHER_RETRY_MS,
  WEATHER_WIDTH,
  type WeatherIconKind,
  type WeatherModel,
  type WeatherView,
  type WeatherWidget,
  type WeatherWidgetOptions,
  weatherIconKind,
  weatherView,
} from './weather-widget';
export { disposeOwned, type SpatialWidget } from './widget';
export {
  createWristMenuWatch,
  WRIST_WATCH_EXTENT,
  WRIST_WATCH_NEAR_EXIT_GAP,
  WRIST_WATCH_PROBE_REACH,
  type WristMenuWatch,
} from './wrist-menu-watch';
export { createXrRadialMenu } from './xr-radial-menu';
export {
  createXrSession,
  FOVEATION_LEVELS,
  type FoveationLevel,
  type XrSession,
  type XrSessionOptions,
} from './xr-session';
