import type { WorkspaceActions } from '../../src/contracts';

/** A complete `WorkspaceActions` that does nothing, for browser fixtures that only render the scene. */
export function createNoopActions(overrides: Partial<WorkspaceActions> = {}): WorkspaceActions {
  return {
    selectPane: () => undefined,
    closePane: () => undefined,
    createPane: () => undefined,
    sendText: () => undefined,
    sendKey: () => undefined,
    sendMouse: () => true,
    scrollTerminal: () => false,
    runCommand: () => undefined,
    openKeyboard: () => undefined,
    openCommands: () => undefined,
    setXREntryMode: () => undefined,
    exitPreview: () => undefined,
    resizeGrid: () => true,
    setTerminalColorMode: () => undefined,
    setKeyboardBackground: () => undefined,
    reloadApp: () => undefined,
    saveCommand: () => true,
    removeCommand: () => true,
    togglePaneConnection: () => undefined,
    dictationAction: () => undefined,
    editDictation: () => undefined,
    readHostClipboard: async () => ({ ok: true, value: '' }),
    writeHostClipboard: async () => ({ ok: true, value: 0 }),
    ...overrides,
  };
}
