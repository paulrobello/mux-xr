import type { KeyboardModifier } from '@par/xr-workspace';
import type * as THREE from 'three';
import type { RadialMenuAction } from './radial-menu';

/**
 * The typed contract between XR panel buttons and their handlers. Buttons carry one PanelAction
 * under `userData.action`; handlers switch on `action.type` and end in `assertNever`, so renaming
 * or removing an action is a compile error at every dispatch site.
 *
 * Package widgets keep emitting plain `{ type, ...payload }` objects without importing this
 * module; the members they emit are mirrored here so the shared chain stays exhaustive.
 */

/** A double-press confirm armed on a control. */
export interface ArmedConfirm {
  armed: boolean;
}

/** The hover help and original title a hierarchy control carries beside its action. */
interface NodeCopy {
  helpText?: string;
  originalTitle?: string;
}

export type PanelAction =
  | { type: 'scrollStrip' }
  | { type: 'noop' }
  | { type: 'close' }
  | { type: 'grabInput' }
  | { type: 'exit' }
  | { type: 'openInput'; mode: string }
  | { type: 'dismissNotice' }
  | { type: 'dismissToast'; toastId?: string }
  | { type: 'reloadUpdate' }
  | { type: 'handColor'; handColor: string }
  | { type: 'armColor'; armColor: string }
  | { type: 'accentColor'; accentColor: string }
  | { type: 'environmentAccentColor'; environmentAccentColor: string }
  | { type: 'closePane'; terminalId?: string }
  | { type: 'toggleConnection'; terminalId?: string; status?: string }
  | { type: 'bringHere'; terminalId?: string }
  | { type: 'keepHere' }
  | { type: 'pasteClipboard' }
  | { type: 'pasteHostClipboard' }
  | { type: 'copyToHost' }
  | { type: 'pictureUrl' }
  | { type: 'pictureRecent' }
  | { type: 'pictureChange' }
  | ({ type: 'hierarchyNode'; hierarchyPath?: string[]; hierarchyPage?: number } & NodeCopy)
  | ({ type: 'createPane'; sessionId?: string; createAvailable?: boolean } & NodeCopy)
  | { type: 'selectAgentPane'; agentPaneId?: string }
  | { type: 'selectBellPane'; bellPaneId?: string }
  | ({
      type: 'pane';
      paneId?: string;
      hierarchyPath?: string[];
      hierarchyPage?: number;
    } & NodeCopy)
  | { type: 'radialAction'; radialAction?: RadialMenuAction }
  | { type: 'wristMenu' }
  | { type: 'grabRadial' }
  | { type: 'closeWidget' }
  | { type: 'grabWidget' }
  | { type: 'widgetControl' }
  | { type: 'readStickyNote' }
  | { type: 'key'; key?: string; modifier?: KeyboardModifier }
  | { type: 'keyborbMode'; keyborbMode: string }
  | { type: 'uiSounds' }
  | { type: 'pasteReview'; pasteReview: string }
  | { type: 'zipDigit'; zipDigit: string }
  | { type: 'zipDelete' }
  | { type: 'zipClear' }
  | { type: 'zipSave' }
  | { type: 'zipUnset' }
  | { type: 'backgroundSelect' }
  | { type: 'backgroundScroll'; delta: number }
  | { type: 'background'; background?: unknown }
  | { type: 'backgroundTile'; background?: unknown }
  | { type: 'hierarchyStyle'; hierarchyStyle?: string }
  | { type: 'terminalColors'; colorMode?: string }
  | { type: 'windowPreference'; preference?: string; delta?: number }
  | { type: 'focusWarpMode' }
  | { type: 'scrollStripSide'; scrollStripSide?: string }
  | { type: 'frameChin' }
  | { type: 'buttonMapNext'; controllerButton?: string }
  | { type: 'buttonMapReset' }
  | { type: 'keyboardBackground' }
  | { type: 'gazeInput' }
  | { type: 'keyboardCurvature'; delta?: number }
  | { type: 'dictation'; dictationAction?: string }
  | { type: 'pinNote' }
  | { type: 'curvature'; degrees?: number }
  | { type: 'curvatureStep'; delta?: number }
  | { type: 'warpDone' }
  | { type: 'warpCancel' }
  | { type: 'filterDistance'; delta?: number }
  | { type: 'filterMode'; filterMode?: string }
  | { type: 'filterAnisotropy'; anisotropy?: number }
  | { type: 'filterGaze' }
  | { type: 'resetTerminalAppearance' }
  | { type: 'glassOpacity'; delta?: number }
  | { type: 'fontZoom'; terminalId?: string; direction?: number }
  | { type: 'gridPreset'; cols?: number; rows?: number }
  | { type: 'gridStep'; axis?: string; delta?: number }
  | { type: 'gridApply' }
  | { type: 'newCommand' }
  | { type: 'commandCancel' }
  | { type: 'commandField'; field?: string }
  | { type: 'commandScope' }
  | { type: 'commandNewline' }
  | { type: 'commandConfirm' }
  | { type: 'commandClear' }
  | { type: 'commandSave' }
  | { type: 'commandPage' }
  | { type: 'commandTool'; tool?: string }
  | { type: 'command'; commandId?: string }
  | { type: 'stripCommand'; commandId?: string }
  | { type: 'toggleWidget'; widgetKind?: string }
  | { type: 'widgetsPage'; delta?: number }
  | { type: 'pictureUrlLoad' }
  | { type: 'pictureUrlClear' }
  | { type: 'pictureRecentPage'; delta?: number }
  | { type: 'pictureRecentPlace'; recentId?: string }
  | { type: 'pictureRecentRemove'; recentId?: string }
  | { type: 'stickyNotePage'; delta?: number }
  | { type: 'resetLayout' }
  | { type: 'layoutDepth'; direction?: number }
  | { type: 'arrange'; pattern?: string }
  | { type: 'xrMode'; xrMode?: string };

/**
 * Stores the action and spreads its payload onto `userData`, so handler code reading
 * `hit.userData.delta` keeps working while `getAction` serves the typed object. The
 * `inputAction` string mirror is permanent: package widgets, hand contact, `getControlHints`,
 * the check scripts and the controller tests all identify controls by it.
 */
export function setAction(object: THREE.Object3D, action: PanelAction): void {
  Object.assign(object.userData, action, { inputAction: action.type, action });
}

/** Builds the data bag `createLabelButton` takes: payload plus the style keys it applies. */
export function actionData(
  action: PanelAction,
  style: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...style, ...action, inputAction: action.type, action };
}

/**
 * Reads the typed action out of a `userData` bag. Package widgets, spatial keyboard keys and
 * picture-frame buttons only set the `inputAction` string and its payload keys, so a bag without
 * a stored action is read as `{ ...bag, type: inputAction }`. A type outside the union (a
 * package-defined id) reaches handlers as-is and falls through every typed switch.
 */
export function actionOf(data: Record<string, unknown>): PanelAction | undefined {
  if (data.action) return data.action as PanelAction;
  return typeof data.inputAction === 'string'
    ? ({ ...data, type: data.inputAction } as PanelAction)
    : undefined;
}

/** Reads back the typed action `setAction` (or a package widget's plain object) stored. */
export function getAction(object: THREE.Object3D): PanelAction | undefined {
  return actionOf(object.userData);
}

/** Exhaustiveness guard for `switch (action.type)` dispatch sites. */
export function assertNever(action: never): never {
  throw new Error(`Unhandled panel action: ${JSON.stringify(action)}`);
}
