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

export function getControlHelp(data: Record<string, unknown>): string | undefined {
  if (typeof data.key === 'string') return getKeyHelp(data.key);
  switch (data.inputAction) {
    case 'wristMenu':
      return 'Open the action menu: tap this watch with your left index finger or point and press with the left controller';
    case 'scrollStrip':
      return 'Pinch and drag up or down to scroll this terminal';
    case 'warpDone':
      return 'Keep this curvature';
    case 'warpCancel':
      return 'Restore the curvature from before this Warp panel opened';
    case 'pasteClipboard':
      return 'Paste copied text into the selected terminal without adding Enter';
    case 'pasteHostClipboard':
      return "Type the Mac's clipboard text into the selected terminal without adding Enter";
    case 'copyToHost':
      return "Send the Quest clipboard, or text highlighted in Mux XR, to the Mac's clipboard";
    case 'keyboardCurvature':
      return 'Curve the keyboard without changing terminal size';
    case 'dictation':
      return data.dictationAction === 'insert'
        ? 'Insert the reviewed transcript without pressing Enter'
        : data.dictationAction === 'clear'
          ? 'Clear the reviewed dictation text without stopping or cancelling dictation'
          : data.dictationAction === 'stop'
            ? 'Stop listening and review the transcript'
            : data.dictationAction === 'cancel'
              ? 'Discard the transcript and stop listening'
              : 'Use browser speech recognition, then review before inserting';
    case 'hierarchyStyle':
      return 'Switch the mux tree between Helix Navigator and Spatial Docks';
    case 'hierarchyNode':
      return 'Explore this branch of the mux tree; grip to move or rotate the whole tree';
    case 'windowPreference':
      return data.preference === 'defaultOpacity'
        ? 'Set glass opacity for newly opened windows; existing panes keep their opacity'
        : data.preference === 'defaultCurvature'
          ? 'Set curvature for newly opened windows; existing panes keep their warp'
          : data.preference === 'focusDistance'
            ? 'Set how far the focused window appears in front of you'
            : 'Set temporary focus curvature; the original warp returns when focus ends';
    case 'glassOpacity':
      return 'Adjust the dark terminal background opacity';
    case 'resetTerminalAppearance':
      return "Forget this pane's saved glass opacity and warp so it follows the new-window defaults";
    case 'radialAction':
      return data.radialAction === 'warp'
        ? 'Adjust terminal curvature: controllers use the right stick; hands use on-panel choices'
        : data.radialAction === 'layout'
          ? 'Arrange terminals and adjust layout distance'
          : data.radialAction === 'cancel'
            ? 'Close the action menu'
            : `Open ${String(data.radialAction)}`;
    case 'grabRadial':
      return undefined;
    case 'dismissNotice':
      return 'Clear this message';
    case 'filterDistance':
      return 'Set the maximum distance for sharper gaze';
    case 'curvature':
    case 'curvatureStep':
      return 'Bend this screen without changing the terminal grid';
    case 'toggleWidget':
      return 'Show or hide this movable clock';
    case 'closeWidget':
      return 'Close this clock widget';
    case 'grabWidget':
      return undefined;
    case 'filterMode':
      return 'Choose terminal sampling; sharper modes may shimmer';
    case 'filterAnisotropy':
      return 'Choose anisotropy for mipmap modes';
    case 'filterGaze':
      return 'Use sharper sampling for the looked-at terminal';
    case 'newCommand':
      return 'Create a saved quick command';
    case 'commandField':
      return data.field === 'text'
        ? 'Edit the command text; put {{}} where you will type the rest when it runs'
        : 'Choose which field the keyboard edits';
    case 'commandScope':
      return 'Save globally or for this workspace';
    case 'commandNewline':
      return 'Append Enter when running this command';
    case 'commandConfirm':
      return 'Require a second press within 3 seconds to run';
    case 'commandSave':
      return 'Save on this device without running';
    case 'commandClear':
      return 'Clear the current draft field';
    case 'commandCancel':
      return 'Discard this command draft';
    case 'layoutDepth':
      return Number(data.direction) < 0
        ? 'Move all terminals closer; keep sizes'
        : 'Move all terminals farther; keep sizes';
    case 'resetLayout':
      return 'Recover the workspace and UI near the current view; press twice to confirm';
    case 'xrMode':
      return data.xrMode === 'ar'
        ? 'Leave XR, then press Enter passthrough in the browser'
        : 'Leave XR, then press Enter VR in the browser';
    case 'arrange':
      return data.pattern === 'sphere'
        ? 'Arrange terminals on a sphere in front of you'
        : `Arrange terminals in a ${String(data.pattern)}; sizes and input target stay unchanged`;
    case 'reloadUpdate':
      return 'Exit XR and reload the available update';
    case 'keyboardBackground':
      return 'Show or hide the keyboard backing';
    case 'keyborbMode':
      return data.keyborbMode === 'auto'
        ? 'Use Keyborb with hand tracking and the standard keyboard with controllers'
        : data.keyborbMode === 'on'
          ? 'Use spherical keys; trigger or pinch to type'
          : 'Use the standard keyboard';
    case 'uiSounds':
      return 'Turn interface clicks and controller pulses on or off';
    case 'terminalColors':
      return 'Choose terminal color presentation';
    case 'gridPreset':
      return 'Choose a grid preset, then Apply';
    case 'gridStep':
      return 'Edit the grid draft, then Apply';
    case 'gridApply':
      return 'Resize the selected terminal grid';
    case 'gazeInput':
      return 'Toggle head-gaze keyboard targeting after a short dwell; off uses manual selection';
    case 'fontZoom':
      return Number(data.direction) < 0
        ? 'Zoom text out; terminal grid stays unchanged'
        : 'Zoom text in; terminal grid stays unchanged';
    case 'openInput':
    case 'mode':
      return data.mode === 'keyboard'
        ? 'Open terminal text entry and keyboard'
        : data.mode === 'panes'
          ? 'Browse workspaces, sessions, windows and panes'
          : data.mode === 'terminal'
            ? 'Adjust the selected terminal grid, text zoom and glass opacity'
            : data.mode === 'settings'
              ? 'Open display, world and selected-terminal settings'
              : data.mode === 'display'
                ? 'Choose colors, filtering, new-window opacity and focus preferences'
                : data.mode === 'world'
                  ? 'Choose VR background or passthrough'
                  : data.mode === 'widgets'
                    ? 'Open movable digital and analog clocks'
                    : data.mode === 'filtering'
                      ? 'Choose filtering and viewed-terminal clarity'
                      : data.mode === 'arrange'
                        ? 'Arrange attached terminals in a spatial pattern'
                        : 'Open saved quick commands';
    case 'exit':
      return 'Exit immersive mode or the 3D preview; press twice to confirm';
    case 'close':
      return 'Close this panel';
    case 'closePane':
      return 'Close this terminal view; the shell keeps running';
    case 'bringHere':
      return 'Bring this terminal in front of you at the Focus distance and keep it there';
    case 'keepHere':
      return 'End Focus and leave this terminal where it is now';
    case 'toggleConnection':
      return ['connected', 'connecting'].includes(String(data.status))
        ? 'Disconnect this terminal view without stopping the shell'
        : 'Reconnect this terminal view to the running shell';
    case 'backgroundSelect':
      return 'Choose the VR background';
    case 'background':
      return `Use the ${String(data.background)} VR background`;
    case 'command':
      return 'Send this saved command to the input target';
    case 'commandPage':
      return 'Show the next saved commands';
    case 'commandTool':
      return data.tool === 'run'
        ? 'Tap commands to run them'
        : data.tool === 'pin'
          ? 'Tap commands to pin or unpin them'
          : data.tool === 'edit'
            ? 'Tap a command to edit it'
            : 'Tap a command twice to remove it';
    case 'stripCommand':
      return 'Send this pinned or frequent command to the input target';
    case 'pane':
      return 'Open or select this terminal pane';
    case 'panePage':
      return 'Show the next hierarchy entries';
    case 'widgetsPage':
      return 'Show another page of widgets';
    case 'hierarchyNext':
      return 'Browse inside this hierarchy item';
    case 'hierarchyBack':
      return 'Go up one level in the mux hierarchy';
    default:
      return undefined;
  }
}
