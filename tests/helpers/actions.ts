import { vi } from 'vitest';
import type { WorkspaceActions } from '../../src/contracts';

/**
 * A full `WorkspaceActions` whose members are `vi.fn()` spies that do nothing. `sendMouse`, `resizeGrid`,
 * `saveCommand` and `removeCommand` report success; `scrollTerminal` reports that nothing scrolled,
 * so scene code falls back as it did when the member was absent. Pass `overrides`
 * to replace members.
 */
export function createTestActions(overrides: Partial<WorkspaceActions> = {}): WorkspaceActions {
  return {
    selectPane: vi.fn(),
    closePane: vi.fn(),
    createPane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    sendMouse: vi.fn(() => true),
    scrollTerminal: vi.fn(() => false),
    runCommand: vi.fn(),
    openKeyboard: vi.fn(),
    openCommands: vi.fn(),
    setXREntryMode: vi.fn(),
    exitPreview: vi.fn(),
    resizeGrid: vi.fn(() => true),
    setTerminalColorMode: vi.fn(),
    setKeyboardBackground: vi.fn(),
    reloadApp: vi.fn(),
    saveCommand: vi.fn(() => true),
    removeCommand: vi.fn(() => true),
    togglePaneConnection: vi.fn(),
    dictationAction: vi.fn(),
    editDictation: vi.fn(),
    readHostClipboard: vi.fn(async () => ({ ok: true as const, value: '' })),
    writeHostClipboard: vi.fn(async () => ({ ok: true as const, value: 0 })),
    ...overrides,
  };
}
