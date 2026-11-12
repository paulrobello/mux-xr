import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { installKeyboardRouter, type KeyRouterDeps } from '../src/keyboard-router';
import { ignoreXtermKeys } from '../src/terminal/surface';

const routerDeps = (sent: string[], presenting: boolean): KeyRouterDeps => ({
  selectedPaneId: () => 'pane',
  isConnected: () => true,
  applicationCursor: () => false,
  sendBytes: (_id, bytes) => sent.push(bytes),
  textEntryActive: () => false,
  xrPresenting: () => presenting,
  xrEntryFallbackArmed: () => false,
  onKey: () => undefined,
});

describe('physical keys while the hidden xterm textarea has focus', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  for (const presenting of [true, false]) {
    it(`reach the selected pane (${presenting ? 'XR' : 'desktop'})`, () => {
      const host = document.createElement('div');
      document.body.append(host);
      const terminal = new Terminal({ cols: 20, rows: 5, disableStdin: true });
      terminal.open(host);
      ignoreXtermKeys(terminal);
      terminal.focus();
      const sent: string[] = [];
      const dispose = installKeyboardRouter(document, routerDeps(sent, presenting));
      cleanups.push(() => {
        dispose();
        terminal.dispose();
        host.remove();
      });
      const textarea = host.querySelector('textarea');
      expect(textarea?.classList.contains('xterm-helper-textarea')).toBe(true);
      expect(document.activeElement).toBe(textarea);
      for (const key of ['a', 'Enter', 'ArrowUp', 'Backspace']) {
        textarea?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
        );
      }
      expect(sent).toEqual(['a', '\r', '\x1b[A', '\x7f']);
    });
  }
});
