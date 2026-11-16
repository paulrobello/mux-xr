import { actionOf, type PanelAction } from './xr/panel-actions';
import type { InputMode } from './xr/scene-context';

export function getKeyHelp(key: string): string | undefined {
  const hints: Record<string, string> = {
    Escape: 'Send Escape to this terminal',
    Tab: 'Send Tab for completion or indentation',
    Control: 'Ctrl: tap once, hold to lock',
    Alt: 'Alt: tap once, hold to lock',
    Shift: 'Shift: tap once, hold to lock',
    ArrowUp: 'Send Up: previous command or move up',
    ArrowDown: 'Send Down: next command or move down',
    ArrowLeft: 'Send Left: move the cursor left',
    ArrowRight: 'Send Right: move the cursor right',
    Enter: 'Send Enter to run the current command',
    Backspace: 'Delete the character before the cursor',
    Insert: 'Send Insert: toggle insert or overwrite where supported',
    Delete: 'Delete the character under the cursor',
    Home: 'Send Home: move to the start of the line',
    End: 'Send End: move to the end of the line',
    PageUp: 'Send Page Up: scroll or page back',
    PageDown: 'Send Page Down: scroll or page forward',
    ' ': 'Type a space',
  };
  return hints[key];
}

type ActionType = PanelAction['type'];
type HelpEntry<K extends ActionType> =
  | string
  | null
  | ((action: Extract<PanelAction, { type: K }>) => string | null);

/**
 * Hover help per action. A string is the help text, a function derives it from the payload, and
 * `null` marks a control that is intentionally silent. The mapped type makes a missing action a
 * compile error.
 */
export const HELP: { [K in ActionType]: HelpEntry<K> } = {
  scrollStrip: 'Pinch and drag up or down to scroll this terminal',
  noop: null,
  close: 'Close this panel',
  grabInput: null,
  exit: 'Exit immersive mode or the 3D preview; press twice to confirm',
  openInput: (action) => MODE_HELP[action.mode as InputMode] ?? MODE_HELP.commands,
  dismissNotice: 'Clear this message',
  dismissToast: 'Dismiss this toast',
  reloadUpdate: 'Exit XR and reload the available update',
  handColor: (action) =>
    action.handColor
      ? 'Tint both hands and arms with this color'
      : 'Restore the default hand color',
  armColor: (action) =>
    action.armColor ? 'Tint both arms with this color' : 'Color the arms like the hands',
  accentColor: (action) =>
    action.accentColor
      ? 'Use this color for XR highlights, frames and outlines'
      : 'Restore the default cyan accent',
  environmentAccentColor: (action) =>
    action.environmentAccentColor
      ? 'Tint environment glows and inlays with this color'
      : 'Tint environment glows like the interface accent',
  closePane: 'Close this terminal view; the shell keeps running',
  toggleConnection: (action) =>
    ['connected', 'connecting'].includes(String(action.status))
      ? 'Disconnect this terminal view without stopping the shell'
      : 'Reconnect this terminal view to the running shell',
  bringHere: 'Bring this terminal in front of you at the Focus distance and keep it there',
  keepHere: 'End Focus and leave this terminal where it is now',
  pasteClipboard:
    'Paste copied text into the selected terminal without adding Enter; a multiline or altered paste needs a second press to confirm',
  pasteHostClipboard:
    "Type the Mac's clipboard text into the selected terminal without adding Enter",
  copyToHost: "Send the Quest clipboard, or text highlighted in Mux XR, to the Mac's clipboard",
  pictureUrl: null,
  pictureRecent: null,
  pictureChange: null,
  hierarchyNode: 'Explore this branch of the mux tree; grip to move or rotate the whole tree',
  createPane: null,
  selectAgentPane: null,
  selectBellPane: null,
  pane: 'Open or select this terminal pane',
  radialAction: (action) =>
    action.radialAction === 'warp'
      ? 'Right stick: left/right curves, up/down changes opacity. Hands use on-panel curvature controls.'
      : action.radialAction === 'layout'
        ? 'Arrange terminals and adjust layout distance'
        : action.radialAction === 'cancel'
          ? 'Close the action menu'
          : `Open ${String(action.radialAction)}`,
  wristMenu:
    'Open the action menu: tap this watch with your left index finger or point and press with the left controller',
  grabRadial: null,
  closeWidget: 'Close this widget',
  grabWidget: null,
  widgetControl: null,
  readStickyNote: null,
  key: (action) => (typeof action.key === 'string' ? (getKeyHelp(action.key) ?? null) : null),
  keyborbMode: (action) =>
    action.keyborbMode === 'auto'
      ? 'Use Keyborb with hand tracking and the standard keyboard with controllers'
      : action.keyborbMode === 'on'
        ? 'Use spherical keys; trigger or pinch to type'
        : 'Use the standard keyboard',
  uiSounds: 'Turn interface clicks and controller pulses on or off',
  pasteReview: (action) =>
    action.pasteReview === 'off'
      ? 'Paste at once, without a confirming press'
      : action.pasteReview === 'always'
        ? 'Every paste needs a second press to confirm'
        : 'Multiline or altered pastes need a second press to confirm',
  zipDigit: (action) => `Type ${String(action.zipDigit ?? 'a number')} into the weather ZIP`,
  zipDelete: 'Delete the last ZIP number',
  zipClear: 'Clear the ZIP field',
  zipSave: 'Save the ZIP and show its weather',
  zipUnset: 'Remove the weather ZIP',
  backgroundSelect: 'Choose the VR background',
  backgroundScroll: null,
  background: (action) => `Use the ${String(action.background)} VR background`,
  backgroundTile: null,
  hierarchyStyle: 'Switch the mux tree between Helix Navigator and Spatial Docks',
  terminalColors: 'Choose terminal color presentation',
  windowPreference: (action) =>
    action.preference === 'defaultOpacity'
      ? 'Set glass opacity for newly opened windows; existing panes keep their opacity'
      : action.preference === 'defaultCurvature'
        ? 'Set curvature for newly opened windows; existing panes keep their warp'
        : action.preference === 'focusDistance'
          ? 'Set how far the focused window appears in front of you'
          : 'Set temporary focus curvature; the original warp returns when focus ends',
  focusWarpMode: null,
  scrollStripSide: null,
  frameChin: null,
  buttonMapNext: null,
  buttonMapReset: null,
  keyboardBackground: 'Show or hide the keyboard backing',
  gazeInput: 'Toggle head-gaze keyboard targeting after a short dwell; off uses manual selection',
  keyboardCurvature: 'Curve the keyboard without changing terminal size',
  dictation: (action) =>
    DICTATION_HELP[String(action.dictationAction)] ??
    'Use browser speech recognition, then review before inserting',
  pinNote: 'Pin the reviewed transcript in space as a sticky note',
  curvature: 'Bend this screen without changing the terminal grid',
  curvatureStep: 'Bend this screen without changing the terminal grid',
  warpDone: 'Keep this curvature',
  warpCancel: 'Restore the curvature from before this Warp panel opened',
  filterDistance: 'Set the maximum distance for sharper gaze',
  filterMode: 'Choose terminal sampling; sharper modes may shimmer',
  filterAnisotropy: 'Choose anisotropy for mipmap modes',
  filterGaze: 'Use sharper sampling for the looked-at terminal',
  resetTerminalAppearance:
    "Forget this pane's saved glass opacity and warp so it follows the new-window defaults",
  glassOpacity: 'Adjust the dark terminal background opacity',
  fontZoom: (action) =>
    Number(action.direction) < 0
      ? 'Zoom text out; terminal grid stays unchanged'
      : 'Zoom text in; terminal grid stays unchanged',
  gridPreset: 'Choose a grid preset, then Apply',
  gridStep: 'Edit the grid draft, then Apply',
  gridApply: 'Resize the selected terminal grid',
  newCommand: 'Create a saved quick command',
  commandCancel: 'Discard this command draft',
  commandField: (action) =>
    action.field === 'text'
      ? 'Edit the command text; put {{}} where you will type the rest when it runs'
      : 'Choose which field the keyboard edits',
  commandScope: 'Save globally or for this workspace',
  commandNewline: 'Append Enter when running this command',
  commandConfirm: 'Require a second press within 3 seconds to run',
  commandClear: 'Clear the current draft field',
  commandSave: 'Save on this device without running',
  commandPage: 'Show the next saved commands',
  commandTool: (action) =>
    action.tool === 'run'
      ? 'Tap commands to run them'
      : action.tool === 'pin'
        ? 'Tap commands to pin or unpin them'
        : action.tool === 'edit'
          ? 'Tap a command to edit it'
          : 'Tap a command twice to remove it',
  command: 'Send this saved command to the input target',
  stripCommand: 'Send this pinned or frequent command to the input target',
  toggleWidget: 'Show or hide this widget',
  widgetsPage: 'Show another page of widgets',
  pictureUrlLoad: null,
  pictureUrlClear: null,
  pictureRecentPage: null,
  pictureRecentPlace: null,
  pictureRecentRemove: null,
  stickyNotePage: null,
  resetLayout: 'Recover the workspace and UI near the current view; press twice to confirm',
  layoutDepth: (action) =>
    Number(action.direction) < 0
      ? 'Move all terminals closer; keep sizes'
      : 'Move all terminals farther; keep sizes',
  arrange: (action) =>
    action.pattern === 'sphere'
      ? 'Arrange terminals on a sphere in front of you'
      : `Arrange terminals in a ${String(action.pattern)}; sizes and input target stay unchanged`,
  xrMode: (action) =>
    action.xrMode === 'desk'
      ? 'Show the virtual world with a movable passthrough window'
      : action.xrMode === 'ar'
        ? 'Show your real surroundings around the workspace'
        : 'Show the virtual world without passthrough',
};

const DICTATION_HELP: Record<string, string> = {
  insert: 'Insert the reviewed transcript without pressing Enter',
  clear: 'Clear the reviewed dictation text without stopping or cancelling dictation',
  stop: 'Stop listening and review the transcript',
  cancel: 'Discard the transcript and stop listening',
};

const COMMANDS_HELP = 'Open saved quick commands';

/** Help for the panel an `openInput` button opens; modes without their own text share the commands text. */
const MODE_HELP: Record<InputMode, string> = {
  keyboard: 'Open terminal text entry and keyboard',
  panes: 'Browse workspaces, sessions, windows and panes',
  terminal: 'Adjust the selected terminal grid, text zoom and glass opacity',
  settings: 'Open display, world and selected-terminal settings',
  display: 'Choose colors, filtering, new-window opacity and focus preferences',
  world: 'Choose VR background, passthrough, hand and accent colors and the weather ZIP',
  'weather-zip': 'Enter the US ZIP code the weather widget shows',
  accent: 'Choose the interface and environment accent colors',
  widgets: 'Open movable widgets: clocks, weather, timer, performance, pictures and boards',
  filtering: 'Choose filtering and viewed-terminal clarity',
  arrange: 'Arrange attached terminals in a spatial pattern',
  commands: COMMANDS_HELP,
  'command-editor': COMMANDS_HELP,
  'sticky-note-reader': COMMANDS_HELP,
  warp: COMMANDS_HELP,
  backgrounds: COMMANDS_HELP,
  buttons: COMMANDS_HELP,
  'picture-url': COMMANDS_HELP,
  'picture-gallery': COMMANDS_HELP,
};

/** The hover help for a typed action, or undefined for an intentionally silent control. */
export function getControlHelp(action: PanelAction | undefined): string | undefined {
  if (!action) return undefined;
  const entry = HELP[action.type] as HelpEntry<ActionType>;
  const text = typeof entry === 'function' ? entry(action as never) : entry;
  return text ?? undefined;
}

/**
 * The hover help for a control's `userData` bag. A bag with a `key` string is a keyboard key
 * whatever else it carries. Package widgets and keys only set the `inputAction` string, so the
 * bag is read through the same adapter the dispatcher uses.
 */
export function getControlHelpFor(data: Record<string, unknown>): string | undefined {
  if (typeof data.key === 'string') return getKeyHelp(data.key);
  return getControlHelp(actionOf(data));
}
