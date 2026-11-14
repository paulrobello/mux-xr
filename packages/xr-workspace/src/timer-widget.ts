import * as THREE from 'three';
import { createScalableLabel, updateScalableLabel } from './labels';
import {
  COUNTDOWN_PRESET_MINUTES,
  createTimerState,
  displaySeconds,
  readout,
  reset,
  selectPreset,
  type TimerStatus,
  tick,
  toggleMode,
  toggleRun,
} from './timer-state';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type SpatialWidget } from './widget';

// 0.27 m leaves 15 mm to each clock body once centred in the actual gap (see the registry).
export const TIMER_WIDTH = 0.27;
export const TIMER_HEIGHT = 0.325;
const FACE_INSET = 0.01;
const CONTROL_INSET = 0.02;
const FACE_WIDTH = TIMER_WIDTH - 2 * FACE_INSET;
const FACE_HEIGHT = TIMER_HEIGHT - 2 * FACE_INSET;
/** Controls span the face minus the vertical inset, edge to edge across the face width. */
const CONTENT_WIDTH = FACE_WIDTH - 2 * FACE_INSET;
const CONTENT_TOP = FACE_HEIGHT / 2 - CONTROL_INSET;
const LEFT = -CONTENT_WIDTH / 2;
const GAP = 0.01;

const TOP_ROW = 0.05;
const DISPLAY_HEIGHT = 0.09;
const RUN_ROW = 0.05;
const PRESET_ROW = 0.045;
const PRESET_WIDTH = 0.048;
const CLOSE_SIZE = 0.05;
// Countdown rows, top to bottom. Stopwatch mode drops the presets, so its display grows and the
// run row drops into the freed band.
const TOP_Y = CONTENT_TOP - TOP_ROW / 2;
const DISPLAY_Y = CONTENT_TOP - TOP_ROW - GAP - DISPLAY_HEIGHT / 2;
const RUN_Y = DISPLAY_Y - DISPLAY_HEIGHT / 2 - GAP - RUN_ROW / 2;
const PRESET_Y = RUN_Y - RUN_ROW / 2 - GAP - PRESET_ROW / 2;
const STOPWATCH_RUN_Y = PRESET_Y - (PRESET_ROW - RUN_ROW) / 2;
const STOPWATCH_DISPLAY_TOP = DISPLAY_Y + DISPLAY_HEIGHT / 2;
const STOPWATCH_DISPLAY_BOTTOM = STOPWATCH_RUN_Y + RUN_ROW / 2 + GAP;
const STOPWATCH_DISPLAY_HEIGHT = STOPWATCH_DISPLAY_TOP - STOPWATCH_DISPLAY_BOTTOM;
const STOPWATCH_DISPLAY_Y = (STOPWATCH_DISPLAY_TOP + STOPWATCH_DISPLAY_BOTTOM) / 2;

/** One font size per row, so labels in a row never differ with their text length. */
const FONT_MODE = 0.026;
const FONT_RUN = 0.024;
const FONT_PRESET = 0.022;
const FONT_BADGE = 0.016;

/** Presets are 0.048 m; at this minimum scale they stay about 30 mm. */
const SCALE_LIMITS: [number, number] = [0.65, 2];

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const DISPLAY_PLATE_COLOR = 0x15232b;
const DONE_COLOR = 0xe8a53c;
const BUTTON_BACKGROUND = '#223946';
const BADGE_BACKGROUND = '#6b4a14';

let nextTimerId = 1;

const RUN_LABELS: Record<TimerStatus, string> = {
  idle: 'Start',
  running: 'Pause',
  paused: 'Resume',
  done: 'Restart',
};

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

export function createTimerWidget(envMap: THREE.Texture | null = null): SpatialWidget {
  const widgetId = `timer-${nextTimerId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = SCALE_LIMITS;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(TIMER_WIDTH, TIMER_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'timer-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(FACE_WIDTH, FACE_HEIGHT, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'timer-face';
  face.position.z = 0.014;
  root.add(body, face);

  const control = (
    name: string,
    text: string,
    width: number,
    height: number,
    x: number,
    y: number,
    command: string,
    help: string,
    fontSize: number,
  ): THREE.Mesh => {
    const button = createScalableLabel(text, width, height, {
      background: BUTTON_BACKGROUND,
      fontSize,
    });
    button.name = name;
    button.position.set(x, y, 0.034);
    button.userData.inputAction = 'widgetControl';
    button.userData.timerCommand = command;
    button.userData.helpText = help;
    root.add(button);
    return button;
  };

  const modeWidth = CONTENT_WIDTH - CLOSE_SIZE - GAP;
  const modeButton = control(
    'timer-mode',
    'Countdown',
    modeWidth,
    TOP_ROW,
    LEFT + modeWidth / 2,
    TOP_Y,
    'toggleMode',
    'Switch between countdown and stopwatch',
    FONT_MODE,
  );
  const close = createScalableLabel('×', CLOSE_SIZE, CLOSE_SIZE, { background: BUTTON_BACKGROUND });
  close.name = 'timer-close';
  close.position.set(TIMER_WIDTH / 2 - CLOSE_SIZE / 2, TIMER_HEIGHT / 2 - CLOSE_SIZE / 2, 0.034);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the timer';
  root.add(close);

  const displayPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(CONTENT_WIDTH, DISPLAY_HEIGHT),
    new THREE.MeshBasicMaterial({ color: DISPLAY_PLATE_COLOR }),
  );
  displayPlate.name = 'timer-display-plate';
  displayPlate.position.set(0, DISPLAY_Y, 0.03);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(CONTENT_WIDTH, DISPLAY_HEIGHT),
    new THREE.MeshBasicMaterial({
      color: DONE_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  flash.name = 'timer-flash';
  flash.position.set(0, DISPLAY_Y, 0.031);
  flash.visible = false;
  const display = createScalableLabel('5:00', CONTENT_WIDTH, 0.08, { backplate: false });
  display.name = 'timer-display';
  display.position.set(0, DISPLAY_Y, 0.032);
  // Sits in the display's top band, clear of the digits, when a countdown ended off screen.
  const badge = createScalableLabel('Countdown done', CONTENT_WIDTH - 0.04, 0.026, {
    background: BADGE_BACKGROUND,
    fontSize: FONT_BADGE,
  });
  badge.name = 'timer-done-badge';
  badge.position.set(0, STOPWATCH_DISPLAY_TOP - 0.02, 0.034);
  badge.visible = false;
  root.add(displayPlate, flash, display, badge);

  const runWidth = (CONTENT_WIDTH - GAP) / 2;
  const runButton = control(
    'timer-run',
    'Start',
    runWidth,
    RUN_ROW,
    LEFT + runWidth / 2,
    RUN_Y,
    'toggleRun',
    'Start or pause the timer',
    FONT_RUN,
  );
  const resetButton = control(
    'timer-reset',
    'Reset',
    runWidth,
    RUN_ROW,
    LEFT + CONTENT_WIDTH - runWidth / 2,
    RUN_Y,
    'reset',
    'Reset the timer',
    FONT_RUN,
  );

  const presetPitch = (CONTENT_WIDTH - PRESET_WIDTH) / (COUNTDOWN_PRESET_MINUTES.length - 1);
  const presets = COUNTDOWN_PRESET_MINUTES.map((minutes, index) => {
    const button = control(
      `timer-preset-${minutes}`,
      `${minutes}m`,
      PRESET_WIDTH,
      PRESET_ROW,
      LEFT + PRESET_WIDTH / 2 + index * presetPitch,
      PRESET_Y,
      'preset',
      `Count down ${minutes} minute${minutes === 1 ? '' : 's'}`,
      FONT_PRESET,
    );
    button.userData.timerMinutes = minutes;
    return button;
  });

  let state = createTimerState();
  let lastText = '';
  let lastStatus: TimerStatus | null = null;
  let lastMode: string | null = null;
  let lastSecond = Number.NaN;
  let lastCountdownStatus: TimerStatus | null = null;
  let animating = false;
  let disposed = false;

  const layout = (countdown: boolean): void => {
    for (const preset of presets) {
      preset.visible = countdown;
      preset.userData.inputAction = countdown ? 'widgetControl' : 'grabWidget';
    }
    const plateY = countdown ? DISPLAY_Y : STOPWATCH_DISPLAY_Y;
    const scaleY = countdown ? 1 : STOPWATCH_DISPLAY_HEIGHT / DISPLAY_HEIGHT;
    for (const plate of [displayPlate, flash]) {
      plate.position.y = plateY;
      plate.scale.y = scaleY;
    }
    display.position.y = plateY;
    const runY = countdown ? RUN_Y : STOPWATCH_RUN_Y;
    runButton.position.y = runY;
    resetButton.position.y = runY;
  };

  const refresh = (nowMs: number): void => {
    const next = readout(state, nowMs);
    lastSecond = displaySeconds(state, nowMs);
    lastCountdownStatus = state.countdown.status;
    if (next.text !== lastText) {
      lastText = next.text;
      setText(display, next.text);
    }
    if (next.mode !== lastMode) {
      lastMode = next.mode;
      setText(modeButton, next.mode === 'countdown' ? 'Countdown' : 'Stopwatch');
      layout(next.mode === 'countdown');
    }
    if (next.status !== lastStatus) {
      lastStatus = next.status;
      setText(runButton, RUN_LABELS[next.status]);
    }
    badge.visible = next.doneBadge;
    const doneSteady = next.mode === 'countdown' && next.status === 'done';
    // 2 Hz amber pulse for the flash window, then a steady dim tint while the face reads Done.
    const opacity = next.flash
      ? 0.45 + 0.45 * (0.5 + 0.5 * Math.sin((nowMs / 1000) * Math.PI * 4))
      : doneSteady
        ? 0.25
        : 0;
    animating = next.flash;
    flash.visible = opacity > 0;
    flash.material.opacity = opacity;
  };

  const update = (nowMs: number): void => {
    if (disposed) return;
    state = tick(state, nowMs);
    // Idle and running frames between second boundaries change nothing on screen.
    if (
      !animating &&
      state.countdown.status === lastCountdownStatus &&
      displaySeconds(state, nowMs) === lastSecond
    )
      return;
    refresh(nowMs);
  };

  const activate = (target: THREE.Object3D): void => {
    if (disposed) return;
    const nowMs = Date.now();
    switch (target.userData.timerCommand) {
      case 'toggleMode':
        state = toggleMode(state, nowMs);
        break;
      case 'toggleRun':
        state = toggleRun(state, nowMs);
        break;
      case 'reset':
        state = reset(tick(state, nowMs));
        break;
      case 'preset':
        state = selectPreset(state, Number(target.userData.timerMinutes));
        break;
      default:
        return;
    }
    refresh(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };

  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'timer';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  refresh(Date.now());
  return { root, update, dispose, activate };
}
