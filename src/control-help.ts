export function getKeyHelp(key: string): string | undefined {
  const hints: Record<string, string> = {
    Escape: 'Send Escape to this terminal',
    Tab: 'Send Tab for completion or indentation',
    Control: 'Toggle Ctrl for the next terminal key',
    Alt: 'Toggle Alt for the next terminal key',
    Shift: 'Use uppercase or symbols for the next key',
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
            : data.mode === 'arrange'
              ? 'Arrange attached terminals in a spatial pattern'
              : 'Open saved quick commands';
    case 'exit':
      return 'Exit immersive mode or the 3D preview';
    case 'close':
      return 'Close terminal input controls';
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
