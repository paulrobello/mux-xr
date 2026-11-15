import {
  createKeyborbKey,
  type KeyboardModifier,
  keyboardDimensions,
  keyboardKeys,
} from '@par/xr-workspace';
import type * as THREE from 'three';
import { getControlHelp } from '../../control-help';
import type { DictationAction } from '../../speech-input';
import { ARMED_STYLE, createLabelButton, stackAboveControls } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';
import { addKeyboardKeys, addKeyborbBatches, KEYBOARD_UNIT } from '../spatial-keyboard';

// Keyborb panel buttons sit out of pinch reach, so dictation gets its own orb in the top row.
const KEYBORB_DICTATION_COLUMN = 9;

/**
 * The keyboard keys every typing panel shows: the panel/keyborb keys, the Keyborb Mic orb and the
 * batched keyborb shells. `panels/keyboard.ts`, `command-editor` and `picture-url` all call it.
 */
export function addKeyboardKeysSection(root: THREE.Group, ctx: SceneContext): void {
  const state = ctx.mutableState;
  const unit = KEYBOARD_UNIT;
  addKeyboardKeys(
    root,
    state.keyborbEnabled ? 'keyborb' : 'panel',
    Boolean(ctx.modifierState.active.shift),
    (mesh) => {
      mesh.userData.helpText = getControlHelp(mesh.userData);
    },
  );
  const dictation = state.dictation;
  if (state.keyborbEnabled && dictation.supported) {
    const listening = dictation.status === 'listening';
    const transcribing = dictation.status === 'transcribing';
    const mic = createKeyborbKey(transcribing ? '...' : listening ? 'Stop' : 'Mic', unit - 0.025);
    mic.name = 'keyborb-dictation';
    Object.assign(mic.userData, {
      keyborbSlot: keyboardKeys.length,
      inputAction: transcribing ? 'noop' : 'dictation',
      dictationAction: listening ? 'stop' : dictation.forNote ? 'startNote' : 'start',
    });
    mic.userData.helpText = transcribing
      ? 'Transcribing your dictation'
      : getControlHelp(mic.userData);
    if (listening) {
      mic.userData.restColor = 0xff7373;
      (mic.material as THREE.Material & { color: THREE.Color }).color.setHex(0xff7373);
    }
    mic.position.set(
      (KEYBORB_DICTATION_COLUMN + 0.5 - keyboardDimensions.width / 2) * unit,
      0.48 - 0.5 * unit,
      (unit - 0.025) / 2 + 0.003,
    );
    root.add(mic);
  }
  if (state.keyborbEnabled) addKeyborbBatches(root);
}

export const keyboardPanel: PanelModule = {
  desktopSwap: 'keyboard',
  title: (ctx) =>
    `${ctx.mutableState.keyborbEnabled ? 'Keyborb' : 'Keyboard'} · ${
      ctx.mutableState.inputTargetTitle
        ? `Target: ${ctx.mutableState.inputTargetTitle}`
        : 'No target selected'
    }`,
  build(root: THREE.Group, ctx: SceneContext): void {
    const state = ctx.mutableState;
    const backdropToggle = createLabelButton(
      `Backing: ${state.keyboardBackgroundEnabled ? 'on' : 'off'}`,
      0.34,
      0.09,
      { inputAction: 'keyboardBackground' },
    );
    // Flanks the 0.9-wide target label (x -0.45..0.45) at its own height.
    backdropToggle.position.set(0.45 + 0.04 + 0.34 / 2, 0.56, 0);
    root.add(backdropToggle);
    const gazeToggle = createLabelButton(
      `Gaze input: ${state.gazeInputEnabled ? 'on' : 'off'}`,
      0.5,
      0.09,
      { inputAction: 'gazeInput' },
    );
    gazeToggle.position.set(-(0.45 + 0.04 + 0.5 / 2), 0.56, 0);
    root.add(gazeToggle);
    const curvature = createLabelButton(
      `Keyboard curve: ${Math.round(state.keyboardCurvature)}°`,
      0.8,
      0.09,
      { inputAction: 'noop' },
    );
    curvature.position.set(0, 0.7, 0);
    root.add(curvature);
    for (const direction of [-1, 1]) {
      const step = createLabelButton(direction < 0 ? '−' : '+', 0.16, 0.09, {
        inputAction: 'keyboardCurvature',
        delta: direction * 10,
      });
      step.position.set(direction * 0.52, 0.7, 0);
      root.add(step);
    }
    const dictation = state.dictation;
    const canReview = ['review', 'error'].includes(dictation.status) && dictation.transcript.trim();
    // The Keyborb Mic orb starts and stops dictation, so its panel keeps only the review buttons.
    if (!state.keyborbEnabled || !dictation.supported) {
      const dictate = createLabelButton(
        dictation.status === 'transcribing'
          ? 'Transcribing…'
          : dictation.status === 'listening'
            ? 'Stop dictation'
            : dictation.supported
              ? 'Dictation'
              : 'Speech unavailable',
        0.7,
        0.1,
        {
          inputAction:
            dictation.supported && dictation.status !== 'transcribing' ? 'dictation' : 'noop',
          dictationAction:
            dictation.status === 'listening' ? 'stop' : dictation.forNote ? 'startNote' : 'start',
        },
      );
      dictate.name = 'xr-dictate-button';
      dictate.position.set(-0.42, 0.87, 0);
      root.add(dictate);
    }
    const paste = createLabelButton('Paste', 0.44, 0.1, { inputAction: 'pasteClipboard' });
    paste.position.set(-1, 0.87, 0);
    root.add(paste);
    // Flank the curvature row (its − and + end at x ±0.6) with the host clipboard actions.
    const hostPaste = createLabelButton('Paste host', 0.4, 0.09, {
      inputAction: 'pasteHostClipboard',
    });
    hostPaste.position.set(-0.85, 0.7, 0);
    const toHost = createLabelButton('Copy to host', 0.4, 0.09, { inputAction: 'copyToHost' });
    toHost.position.set(0.85, 0.7, 0);
    root.add(hostPaste, toHost);
    if (canReview) {
      const confirm = dictation.forNote
        ? createLabelButton('Create note', 0.5, 0.1, { inputAction: 'pinNote' })
        : createLabelButton('Insert text', 0.5, 0.1, {
            inputAction: 'dictation',
            dictationAction: 'insert',
          });
      if (dictation.forNote) confirm.name = 'xr-dictation-pin-note';
      confirm.position.set(0.25, 0.87, 0);
      root.add(confirm);

      const clear = createLabelButton('Clear', 0.38, 0.1, {
        inputAction: 'dictation',
        dictationAction: 'clear',
      });
      clear.position.set(1.17, 0.87, 0);
      root.add(clear);
    }
    if (dictation.status !== 'idle') {
      const cancel = createLabelButton('Cancel', 0.35, 0.1, {
        inputAction: 'dictation',
        dictationAction: 'cancel',
      });
      cancel.position.set(0.73, 0.87, 0);
      root.add(cancel);
      const transcript = createLabelButton(ctx.dictationCaption(), 1.85, 0.34, {
        inputAction: 'noop',
        wrap: true,
      });
      transcript.name = 'xr-dictation-transcript';
      transcript.position.set(0, 1.17, 0);
      root.add(transcript);
      // Sits over the transcript box's left edge, the box being 1.85 wide and 0.34 tall.
      const heading = createLabelButton(
        dictation.forNote ? 'Sticky note' : 'Transcript',
        0.5,
        0.1,
        { inputAction: 'noop' },
      );
      heading.name = 'xr-dictation-transcript-heading';
      heading.position.set(-0.925 + 0.25, 1.17 + 0.17 + 0.06, 0);
      root.add(heading);
      if (canReview && !dictation.forNote) {
        // Mirrors the heading at the transcript box's right edge.
        const pin = createLabelButton('Pin as note', 0.5, 0.1, { inputAction: 'pinNote' });
        pin.name = 'xr-dictation-pin-note';
        pin.position.set(0.925 - 0.25, 1.17 + 0.17 + 0.06, 0);
        root.add(pin);
      }
    }
    addKeyboardKeysSection(root, ctx);
    // Strip commands and hints stack above the controls, after the panel content is placed.
    const stacked: THREE.Mesh[][] = [];
    if (ctx.stripCommands.length)
      stacked.push(
        ctx.stripCommands.map((command) =>
          createLabelButton(ctx.commandButtonLabel(command, 'stripCommand'), 0.44, 0.09, {
            inputAction: 'stripCommand',
            commandId: command.id,
            ...(ctx.isArmed(command.id, 'stripCommand') ? ARMED_STYLE : {}),
          }),
        ),
      );
    const templateHint = ctx.templateHint;
    if (templateHint) {
      const hint = createLabelButton(`Then type: ${templateHint}`, 1.4, 0.09, {
        inputAction: 'noop',
      });
      hint.name = 'xr-template-hint';
      stacked.push([hint]);
    }
    const preview = ctx.armedPreview('stripCommand');
    if (preview) {
      const line = createLabelButton(preview, 1.4, 0.09, { inputAction: 'noop' });
      line.name = 'xr-command-preview';
      stacked.push([line]);
    }
    stackAboveControls(root, stacked);
  },
  handleEarly(action, hit, ctx) {
    if (action === 'keyboardCurvature') {
      ctx.setKeyboardCurvature(ctx.mutableState.keyboardCurvature + Number(hit.userData.delta));
      return true;
    }
    if (action === 'dictation') {
      ctx.actions.dictationAction?.(hit.userData.dictationAction as DictationAction);
      return true;
    }
    if (action === 'pinNote') {
      ctx.pinNote();
      return true;
    }
    if (action === 'copyToHost') {
      // In a session the native select event, which carries user activation, runs this instead.
      if (!ctx.renderer?.xr.isPresenting) void ctx.copyQuestToHost();
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action === 'keyboardBackground') {
      const enabled = !ctx.mutableState.keyboardBackgroundEnabled;
      ctx.actions.setKeyboardBackground?.(enabled);
      ctx.setKeyboardBackgroundEnabled(enabled);
      return true;
    }
    if (action === 'gazeInput') {
      ctx.setGazeInputEnabled(!ctx.mutableState.gazeInputEnabled);
      return true;
    }
    if (action === 'key' && ctx.dictationReview()) {
      const modifier = hit.userData.modifier as KeyboardModifier | undefined;
      if (modifier) {
        ctx.modifierState.tap(modifier);
        ctx.syncModifierVisuals();
      } else ctx.editDictationKey(String(hit.userData.key));
      return true;
    }
    if (
      action === 'key' &&
      ['listening', 'transcribing'].includes(ctx.mutableState.dictation.status)
    )
      return true;
    return false;
  },
};
