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
    ' ': 'Type a space',
  };
  return hints[key];
}

export function getControlHelp(data: Record<string, unknown>): string | undefined {
  if (typeof data.key === 'string') return getKeyHelp(data.key);
  switch (data.inputAction) {
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
      return 'Choose which field the keyboard edits';
    case 'commandScope':
      return 'Save globally or for this workspace';
    case 'commandNewline':
      return 'Append Enter when running this command';
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
    case 'arrange':
      return data.pattern === 'sphere'
        ? 'Arrange terminals on a sphere in front of you'
        : `Arrange terminals in a ${String(data.pattern)}; sizes and input target stay unchanged`;
    case 'reloadUpdate':
      return 'Exit XR and reload the available update';
    case 'keyboardBackground':
      return 'Show or hide the keyboard backing';
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
            ? 'Open terminal grid and color settings'
            : data.mode === 'widgets'
              ? 'Open movable digital and analog clocks'
              : data.mode === 'filtering'
                ? 'Choose filtering and viewed-terminal clarity'
                : data.mode === 'arrange'
                  ? 'Arrange attached terminals in a spatial pattern'
                  : 'Open saved quick commands';
    case 'exit':
      return 'Exit immersive mode or the 3D preview';
    case 'close':
      return 'Close terminal input controls';
    case 'closePane':
      return 'Close this terminal view; the shell keeps running';
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
    case 'pane':
      return 'Open or select this terminal pane';
    case 'panePage':
      return 'Show the next hierarchy entries';
    case 'hierarchyNext':
      return 'Browse inside this hierarchy item';
    case 'hierarchyBack':
      return 'Go up one level in the mux hierarchy';
    default:
      return undefined;
  }
}
