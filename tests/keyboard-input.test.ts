import { describe, expect, it, vi } from 'vitest';
import { createKeyFlash, formatKeyIndicator } from '../src/key-indicator';
import { describeKey, type KeyEventLike, keyEventToTerminalBytes } from '../src/keyboard-input';
import { isEditableTarget, type KeyRouterDeps, routeKeydown } from '../src/keyboard-router';

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});
const bytes = (key: string, mods: Partial<KeyEventLike> = {}, applicationCursor = false) =>
  keyEventToTerminalBytes(ev(key, mods), { applicationCursor });

describe('keyEventToTerminalBytes', () => {
  it('maps printable characters and unicode', () => {
    expect(bytes('a')).toBe('a');
    expect(bytes('A', { shiftKey: true })).toBe('A');
    expect(bytes(' ')).toBe(' ');
    expect(bytes('é')).toBe('é');
    expect(bytes('😀')).toBe('😀');
  });

  it('maps editing keys', () => {
    expect(bytes('Enter')).toBe('\r');
    expect(bytes('Backspace')).toBe('\x7f');
    expect(bytes('Tab')).toBe('\t');
    expect(bytes('Tab', { shiftKey: true })).toBe('\x1b[Z');
    expect(bytes('Escape')).toBe('\x1b');
    expect(bytes('Insert')).toBe('\x1b[2~');
    expect(bytes('Delete')).toBe('\x1b[3~');
    expect(bytes('PageUp')).toBe('\x1b[5~');
    expect(bytes('PageDown')).toBe('\x1b[6~');
  });

  it('maps cursor keys in normal and application mode', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'].map((k) => bytes(k))).toEqual([
      '\x1b[A',
      '\x1b[B',
      '\x1b[C',
      '\x1b[D',
    ]);
    expect(bytes('ArrowUp', {}, true)).toBe('\x1bOA');
    expect(bytes('Home')).toBe('\x1b[H');
    expect(bytes('End')).toBe('\x1b[F');
    expect(bytes('Home', {}, true)).toBe('\x1bOH');
  });

  it('modifies cursor keys with the xterm parameter', () => {
    expect(bytes('ArrowRight', { ctrlKey: true })).toBe('\x1b[1;5C');
    expect(bytes('ArrowLeft', { shiftKey: true })).toBe('\x1b[1;2D');
    expect(bytes('ArrowUp', { altKey: true }, true)).toBe('\x1b[1;3A');
    expect(bytes('Delete', { ctrlKey: true })).toBe('\x1b[3;5~');
  });

  it('maps F1 to F12', () => {
    const seq = Array.from({ length: 12 }, (_, i) => bytes(`F${i + 1}`));
    expect(seq).toEqual([
      '\x1bOP',
      '\x1bOQ',
      '\x1bOR',
      '\x1bOS',
      '\x1b[15~',
      '\x1b[17~',
      '\x1b[18~',
      '\x1b[19~',
      '\x1b[20~',
      '\x1b[21~',
      '\x1b[23~',
      '\x1b[24~',
    ]);
    expect(bytes('F5', { shiftKey: true })).toBe('\x1b[15;2~');
    expect(bytes('F1', { ctrlKey: true })).toBe('\x1b[1;5P');
  });

  it('maps Ctrl combinations to control bytes', () => {
    expect(bytes('c', { ctrlKey: true })).toBe('\x03');
    expect(bytes('C', { ctrlKey: true, shiftKey: true })).toBe('\x03');
    expect(bytes('a', { ctrlKey: true })).toBe('\x01');
    expect(bytes('z', { ctrlKey: true })).toBe('\x1a');
    expect(bytes(' ', { ctrlKey: true })).toBe('\x00');
    expect(bytes('@', { ctrlKey: true })).toBe('\x00');
    expect(bytes('[', { ctrlKey: true })).toBe('\x1b');
    expect(bytes('\\', { ctrlKey: true })).toBe('\x1c');
    expect(bytes(']', { ctrlKey: true })).toBe('\x1d');
    expect(bytes('_', { ctrlKey: true })).toBe('\x1f');
    expect(bytes('?', { ctrlKey: true })).toBe('\x7f');
    expect(bytes('Backspace', { ctrlKey: true })).toBe('\x08');
  });

  it('prefixes Alt combinations with ESC', () => {
    expect(bytes('b', { altKey: true })).toBe('\x1bb');
    expect(bytes('Enter', { altKey: true })).toBe('\x1b\r');
    expect(bytes('Backspace', { altKey: true })).toBe('\x1b\x7f');
  });

  it('returns null for modifiers, Cmd combos and unmapped keys', () => {
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'])
      expect(bytes(k)).toBeNull();
    expect(bytes('c', { metaKey: true })).toBeNull();
    expect(bytes('v', { metaKey: true })).toBeNull();
    expect(bytes('ArrowLeft', { metaKey: true })).toBeNull();
    expect(bytes('ContextMenu')).toBeNull();
    expect(bytes('F13')).toBeNull();
    expect(bytes('1', { ctrlKey: true })).toBeNull();
  });
});

describe('Alt, AltGr and layout handling', () => {
  it('sends AltGr characters unprefixed when the AltGraph state is set', () => {
    const altGr = (key: string, code: string, active = true) =>
      keyEventToTerminalBytes({
        ...ev(key, { ctrlKey: true, altKey: true }),
        code,
        getModifierState: (name) => active && name === 'AltGraph',
      });
    expect(altGr('@', 'KeyQ')).toBe('@');
    expect(altGr('€', 'KeyE')).toBe('€');
    expect(altGr('f', 'KeyF', false)).toBe('\x1b\x06');
    expect(altGr('ƒ', 'KeyF', false)).toBe('\x1b\x06');
  });

  it('treats Ctrl+Alt+letter as ESC plus the control byte', () => {
    const e = (key: string, code?: string) =>
      keyEventToTerminalBytes({ ...ev(key, { ctrlKey: true, altKey: true }), code });
    expect(e('f', 'KeyF')).toBe('\x1b\x06');
    expect(e('c', 'KeyC')).toBe('\x1b\x03');
    expect(e('c')).toBe('\x1b\x03');
  });

  it('infers AltGr from a character unlike the physical key when no state API exists', () => {
    const e = (key: string, code: string) =>
      keyEventToTerminalBytes({ ...ev(key, { ctrlKey: true, altKey: true }), code });
    expect(e('@', 'KeyQ')).toBe('@');
    expect(e('€', 'KeyE')).toBe('€');
    expect(e('F', 'KeyF')).toBe('\x1b\x06');
  });

  it('prefixes Option-composed macOS characters with the ASCII of the physical key', () => {
    const e = (key: string, code: string, shiftKey = false) =>
      keyEventToTerminalBytes({ ...ev(key, { altKey: true, shiftKey }), code });
    expect(e('å', 'KeyA')).toBe('\x1ba');
    expect(e('Å', 'KeyA', true)).toBe('\x1bA');
    expect(e('π', 'KeyP')).toBe('\x1bp');
    expect(e('¡', 'Digit1')).toBe('\x1b1');
    expect(e('≤', 'Comma')).toBe('\x1b,');
    expect(e('ü', 'Unidentified')).toBe('ü');
    expect(e('b', 'KeyB')).toBe('\x1bb');
  });

  it('maps Ctrl punctuation and digits to control bytes', () => {
    expect(bytes('/', { ctrlKey: true })).toBe('\x1f');
    expect(bytes('2', { ctrlKey: true })).toBe('\x00');
    expect(bytes('`', { ctrlKey: true })).toBe('\x00');
    expect(['3', '4', '5', '6', '7'].map((k) => bytes(k, { ctrlKey: true }))).toEqual([
      '\x1b',
      '\x1c',
      '\x1d',
      '\x1e',
      '\x1f',
    ]);
    expect(bytes('8', { ctrlKey: true })).toBe('\x7f');
  });

  it('falls back to event.code for Ctrl+letter on non-Latin layouts', () => {
    const c = (key: string, code: string) =>
      keyEventToTerminalBytes({ ...ev(key, { ctrlKey: true }), code });
    expect(c('с', 'KeyC')).toBe('\x03');
    expect(c('д', 'KeyD')).toBe('\x04');
    expect(c('с', 'Unidentified')).toBeNull();
  });
});

describe('describeKey', () => {
  it('labels plain, named and modified keys', () => {
    expect(describeKey(ev('a'))).toBe('a');
    expect(describeKey(ev('Enter'))).toBe('Enter');
    expect(describeKey(ev(' '))).toBe('Space');
    expect(describeKey(ev('c', { ctrlKey: true }))).toBe('Ctrl+C');
    expect(describeKey(ev('Tab', { shiftKey: true }))).toBe('Shift+Tab');
    expect(describeKey(ev('b', { altKey: true }))).toBe('Alt+B');
    expect(describeKey(ev('v', { metaKey: true }))).toBe('Cmd+V');
    expect(describeKey(ev('Shift', { shiftKey: true }))).toBe('Shift');
  });

  it('formats the indicator with a not-sent marker', () => {
    expect(formatKeyIndicator('Enter', true)).toBe('⌨ Enter');
    expect(formatKeyIndicator('Cmd+C', false)).toBe('⌨ Cmd+C (not sent)');
  });
});

describe('isEditableTarget', () => {
  it('recognises editable elements only', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(
      isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
    expect(isEditableTarget({ tagName: 'BODY' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('routeKeydown gating', () => {
  const setup = (over: Partial<KeyRouterDeps> = {}) => {
    const deps = {
      selectedPaneId: () => 'pane-1' as string | null,
      isConnected: () => true,
      applicationCursor: () => false,
      sendBytes: vi.fn(),
      textEntryActive: () => false,
      xrPresenting: () => false,
      xrEntryFallbackArmed: () => false,
      onKey: vi.fn(),
      ...over,
    };
    const fire = (
      key: string,
      extra: {
        target?: unknown;
        path?: unknown[];
        isComposing?: boolean;
      } & Partial<KeyEventLike> = {},
    ) => {
      const { target = { tagName: 'BODY' }, path, isComposing, ...mods } = extra;
      const event = {
        ...ev(key, mods),
        isComposing,
        target: target as EventTarget,
        composedPath: path ? () => path as EventTarget[] : undefined,
        preventDefault: vi.fn(),
      };
      return { event, sent: routeKeydown(event, deps) };
    };
    return { deps, fire };
  };

  it('sends bytes to the selected pane and prevents default', () => {
    const { deps, fire } = setup();
    const { event, sent } = fire('Tab');
    expect(sent).toBe(true);
    expect(deps.sendBytes).toHaveBeenCalledWith('pane-1', '\t');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(deps.onKey).toHaveBeenCalledWith('Tab', true);
  });

  it('passes the pane application cursor mode to the mapper', () => {
    const { deps, fire } = setup({ applicationCursor: () => true });
    fire('ArrowUp');
    expect(deps.sendBytes).toHaveBeenCalledWith('pane-1', '\x1bOA');
  });

  it.each([
    ['input', { tagName: 'INPUT' }],
    ['textarea', { tagName: 'TEXTAREA' }],
    ['select', { tagName: 'SELECT' }],
    ['contenteditable', { tagName: 'DIV', isContentEditable: true }],
  ])('ignores keys typed in %s and never reports them', (_name, target) => {
    const { deps, fire } = setup();
    const { event, sent } = fire('a', { target });
    expect(sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(deps.onKey).not.toHaveBeenCalled();
  });

  it('checks the composed path origin so shadow-DOM inputs are never reported', () => {
    const { deps, fire } = setup();
    const { sent } = fire('s', { target: { tagName: 'DIV' }, path: [{ tagName: 'INPUT' }] });
    expect(sent).toBe(false);
    expect(deps.onKey).not.toHaveBeenCalled();
  });

  it.each([
    ['button', { tagName: 'BUTTON', matches: (): boolean => true }],
    ['link', { tagName: 'A', hasAttribute: () => true, matches: (): boolean => true }],
    ['summary', { tagName: 'SUMMARY', matches: (): boolean => true }],
    ['scene-host button', { tagName: 'BUTTON', closest: () => ({}), matches: (): boolean => true }],
  ])('holds back activation keys on a keyboard-focused %s', (_name, target) => {
    const { deps, fire } = setup();
    for (const key of ['Enter', ' ', 'Tab']) {
      const { event, sent } = fire(key, { target });
      expect(sent).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(fire('Tab', { target, shiftKey: true }).sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
    expect(deps.onKey).toHaveBeenCalledWith('Enter', false);
  });

  it('routes other keys while a button keeps focus after a click', () => {
    const { deps, fire } = setup();
    const target = { tagName: 'BUTTON', closest: () => null, matches: (): boolean => true };
    expect(fire('l', { target }).sent).toBe(true);
    expect(fire('Escape', { target }).sent).toBe(true);
    expect(fire('ArrowUp', { target }).sent).toBe(true);
    expect(fire('Backspace', { target }).sent).toBe(true);
    expect(deps.sendBytes).toHaveBeenNthCalledWith(1, 'pane-1', 'l');
  });

  it.each([
    ['mouse-focused', { tagName: 'BUTTON', closest: () => ({}), matches: (): boolean => false }],
    ['without matches()', { tagName: 'BUTTON', closest: () => ({}) }],
    [
      'when matches() throws',
      {
        tagName: 'BUTTON',
        matches: (): boolean => {
          throw new Error('unsupported selector');
        },
      },
    ],
  ])('routes activation keys from a %s button', (_name, target) => {
    const { deps, fire } = setup();
    for (const key of ['Enter', ' ', 'Tab']) {
      const { event, sent } = fire(key, { target });
      expect(sent).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(deps.sendBytes).toHaveBeenNthCalledWith(1, 'pane-1', '\r');
  });

  it('leaves other focused page elements alone', () => {
    const { deps, fire } = setup();
    expect(fire('a', { target: { tagName: 'DIV', closest: () => null } }).sent).toBe(false);
    expect(fire('a', { target: { tagName: 'A', hasAttribute: () => false } }).sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
  });

  it('routes from the canvas, the scene host and the document', () => {
    const { deps, fire } = setup();
    expect(fire('a', { target: { tagName: 'CANVAS' } }).sent).toBe(true);
    expect(fire('a', { target: { tagName: 'DIV', closest: () => ({}) } }).sent).toBe(true);
    expect(fire('a', { target: null }).sent).toBe(true);
    expect(deps.sendBytes).toHaveBeenCalledTimes(3);
  });

  it('routes any non-editable focus while an XR session is presenting', () => {
    const { deps, fire } = setup({ xrPresenting: () => true });
    expect(fire('Enter', { target: { tagName: 'BUTTON' } }).sent).toBe(true);
    expect(deps.sendBytes).toHaveBeenCalledWith('pane-1', '\r');
  });

  it('ignores a stale focused DOM input while XR is presenting', () => {
    const { deps, fire } = setup({ xrPresenting: () => true });
    expect(fire('a', { target: { tagName: 'INPUT' } }).sent).toBe(true);
    expect(deps.sendBytes).toHaveBeenCalledWith('pane-1', 'a');
  });

  it('does not route the key that the XR auto-entry fallback consumes', () => {
    const { deps, fire } = setup({ xrEntryFallbackArmed: () => true });
    expect(fire('a').sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
    expect(deps.onKey).toHaveBeenCalledWith('a', false);
  });

  it('ignores IME composition', () => {
    const { deps, fire } = setup();
    expect(fire('a', { isComposing: true }).sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
  });

  it('does nothing without a selected or connected pane', () => {
    const none = setup({ selectedPaneId: () => null });
    expect(none.fire('a').sent).toBe(false);
    expect(none.deps.sendBytes).not.toHaveBeenCalled();
    const down = setup({ isConnected: () => false });
    const { event, sent } = down.fire('a');
    expect(sent).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(down.deps.onKey).toHaveBeenCalledWith('a', false);
  });

  it('yields to an active in-scene text field', () => {
    const { deps, fire } = setup({ textEntryActive: () => true });
    expect(fire('a').sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
  });

  it('leaves Cmd shortcuts and bare modifiers alone', () => {
    const { deps, fire } = setup();
    const cmd = fire('c', { metaKey: true });
    expect(cmd.sent).toBe(false);
    expect(cmd.event.preventDefault).not.toHaveBeenCalled();
    expect(fire('Shift', { shiftKey: true }).sent).toBe(false);
    expect(deps.sendBytes).not.toHaveBeenCalled();
    expect(deps.onKey).toHaveBeenCalledWith('Cmd+C', false);
  });
});

describe('createKeyFlash', () => {
  it('shows the latest key then clears after the ttl', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const flash = createKeyFlash(show, 1000);
    flash.flash('⌨ a');
    vi.advanceTimersByTime(600);
    flash.flash('⌨ b');
    vi.advanceTimersByTime(600);
    expect(show).toHaveBeenLastCalledWith('⌨ b');
    vi.advanceTimersByTime(500);
    expect(show).toHaveBeenLastCalledWith(null);
    vi.useRealTimers();
  });
});
