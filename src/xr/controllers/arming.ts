import type * as THREE from 'three';
import { previewCommandText } from '../../quick-commands';
import { CONFIRM_LABELS, type ConfirmAction } from '../panel-ui';
import type { InputMode } from '../scene-context';
import type { UICue } from '../ui-feedback';

/** Confirm windows and the armed visual tint, shared with the clipboard paste-review window. */
export const CONFIRM_WINDOW_MS = 3000;
export const CONFIRM_MIN_MS = 350;

const XR_PREVIEW_LENGTH = 60;
const ARMED_TINT = 0xf1b65e;

export type ArmedCommand = { id: string; action: string; kind: 'run' | 'remove'; at: number };
export type ArmedControlState = { action: ConfirmAction; at: number };

/**
 * Everything the arming controller needs from the scene closure. Getters keep live values,
 * matching the closure reads the code replaces.
 */
export interface ArmingDeps {
  cue(kind: UICue, source?: THREE.Group | number | null): void;
  lastSelectSource(): THREE.Group | null;
  disposed(): boolean;
  inputRoot(): THREE.Group | null;
  inputMode(): InputMode;
  refreshInputRoot(mode: InputMode): void;
  menuCommands(): { id: string; text: string }[];
  stripCommands(): { id: string; text: string }[];
  hudRoot(): THREE.Group | null;
  hoveredByController: Map<THREE.Group, THREE.Object3D>;
  updateLabel(object: THREE.Mesh, label: string): void;
}

export interface ArmingController {
  armCommand(next: { id: string; action: string; kind: 'run' | 'remove' }): void;
  disarmCommand(): boolean;
  isArmed(id: string, action: string): boolean;
  hasArmedCommand(): boolean;
  armedCommandKind(): 'run' | 'remove' | null;
  confirmTooSoon(): boolean;
  armedPreview(action: string): string | null;
  syncArmedControls(): void;
  disarmControl(): boolean;
  confirmControl(action: ConfirmAction): boolean;
  armedControlState(): ArmedControlState | null;
  disarmPresses(): void;
  /** Clears both timers and both armed states; the scene's dispose calls this. */
  dispose(): void;
}

/** Command double-press arming and first-press-arm/second-press-confirm control arming. */
export const createArming = (deps: ArmingDeps): ArmingController => {
  let armedCommand: ArmedCommand | null = null;
  let armedTimer: ReturnType<typeof setTimeout> | undefined;
  let armedControl: ArmedControlState | null = null;
  let armedControlTimer: ReturnType<typeof setTimeout> | undefined;
  let resetArmShown = false;

  const disarmCommand = (): boolean => {
    if (armedTimer !== undefined) clearTimeout(armedTimer);
    armedTimer = undefined;
    const wasArmed = armedCommand !== null;
    armedCommand = null;
    return wasArmed;
  };
  const armCommand = (next: { id: string; action: string; kind: 'run' | 'remove' }): void => {
    disarmCommand();
    armedCommand = { ...next, at: Date.now() };
    deps.cue('armed', deps.lastSelectSource());
    armedTimer = setTimeout(() => {
      armedTimer = undefined;
      armedCommand = null;
      if (deps.inputRoot() && !deps.disposed()) deps.refreshInputRoot(deps.inputMode());
    }, CONFIRM_WINDOW_MS);
    if (deps.inputRoot()) deps.refreshInputRoot(deps.inputMode());
  };
  const isArmed = (id: string, action: string): boolean =>
    armedCommand?.id === id && armedCommand.action === action;
  const hasArmedCommand = (): boolean => armedCommand !== null;
  const armedCommandKind = (): 'run' | 'remove' | null => armedCommand?.kind ?? null;
  const confirmTooSoon = (): boolean =>
    armedCommand !== null && Date.now() - armedCommand.at < CONFIRM_MIN_MS;
  const armedPreview = (action: string): string | null => {
    const armed = armedCommand;
    if (armed?.action !== action) return null;
    const command = [...deps.menuCommands(), ...deps.stripCommands()].find(
      (item) => item.id === armed.id,
    );
    if (!command) return null;
    const verb = armed.kind === 'remove' ? 'Removes' : 'Sends';
    return `${verb}: ${previewCommandText(command.text, XR_PREVIEW_LENGTH)}`;
  };
  const syncArmedControls = (): void => {
    const exit = deps.hudRoot()?.children.find((child) => child.userData.inputAction === 'exit') as
      | THREE.Mesh
      | undefined;
    if (exit) {
      const armed = armedControl?.action === 'exit';
      deps.updateLabel(exit, CONFIRM_LABELS.exit[armed ? 1 : 0]);
      exit.userData.armed = armed || undefined;
      exit.userData.restColor = armed ? ARMED_TINT : undefined;
      const material = exit.material as THREE.MeshBasicMaterial;
      if (!deps.hoveredByController.size || ![...deps.hoveredByController.values()].includes(exit))
        material.color?.setHex(armed ? ARMED_TINT : 0xffffff);
    }
    const resetArmed = armedControl?.action === 'resetLayout';
    if (resetArmed === resetArmShown) return;
    resetArmShown = resetArmed;
    if (deps.inputRoot() && deps.inputMode() === 'arrange' && !deps.disposed())
      deps.refreshInputRoot('arrange');
  };
  const disarmControl = (): boolean => {
    if (armedControlTimer !== undefined) clearTimeout(armedControlTimer);
    armedControlTimer = undefined;
    if (!armedControl) return false;
    armedControl = null;
    syncArmedControls();
    return true;
  };
  const disarmPresses = (): void => {
    disarmControl();
    if (disarmCommand() && deps.inputRoot() && !deps.disposed())
      deps.refreshInputRoot(deps.inputMode());
  };
  /** First press arms `action`; a second press inside the confirm window runs it. */
  const confirmControl = (action: ConfirmAction): boolean => {
    if (armedControl?.action === action) {
      if (Date.now() - armedControl.at < CONFIRM_MIN_MS) return false;
      disarmControl();
      return true;
    }
    disarmControl();
    armedControl = { action, at: Date.now() };
    armedControlTimer = setTimeout(() => {
      armedControlTimer = undefined;
      armedControl = null;
      if (!deps.disposed()) syncArmedControls();
    }, CONFIRM_WINDOW_MS);
    deps.cue('armed', deps.lastSelectSource());
    syncArmedControls();
    return false;
  };
  const armedControlState = (): ArmedControlState | null => armedControl;
  const dispose = (): void => {
    if (armedTimer !== undefined) clearTimeout(armedTimer);
    armedTimer = undefined;
    if (armedControlTimer !== undefined) clearTimeout(armedControlTimer);
    armedControlTimer = undefined;
    armedCommand = null;
    armedControl = null;
  };

  return {
    armCommand,
    disarmCommand,
    isArmed,
    hasArmedCommand,
    armedCommandKind,
    confirmTooSoon,
    armedPreview,
    syncArmedControls,
    disarmControl,
    confirmControl,
    armedControlState,
    disarmPresses,
    dispose,
  };
};
