export interface KeyEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  getModifierState?(key: string): boolean;
}

export interface KeyMapOptions {
  readonly applicationCursor?: boolean;
}

const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'OS',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'Dead',
  'Process',
  'Unidentified',
]);

const CURSOR_FINALS: Readonly<Record<string, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

const TILDE_CODES: Readonly<Record<string, number>> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
};

const SS3_FUNCTION_FINALS: Readonly<Record<string, string>> = {
  F1: 'P',
  F2: 'Q',
  F3: 'R',
  F4: 'S',
};

export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

const CODE_PUNCTUATION: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: ' ',
};

/** The ASCII character a physical key produces on a US layout, independent of the active layout. */
function asciiFromCode(code: string | undefined, shift: boolean): string | null {
  if (!code) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shift ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return CODE_PUNCTUATION[code] ?? null;
}

/** Ctrl+Alt is how Windows and Linux report AltGr; the AltGraph state decides, else the character must differ from the physical key. */
function isAltGraph(event: KeyEventLike): boolean {
  if (typeof event.getModifierState === 'function') return event.getModifierState('AltGraph');
  const { key } = event;
  const physical = asciiFromCode(event.code, event.shiftKey);
  if (physical === null || !/^[^\p{C}]$/u.test(key)) return false;
  return key !== physical && key.toLowerCase() !== physical && key.toUpperCase() !== physical;
}

const isAscii = (key: string): boolean => /^[\x20-\x7e]$/.test(key);

function controlByte(key: string): string | null {
  if (key === ' ' || key === '@' || key === '2' || key === '`') return '\x00';
  if (key === '[' || key === '3') return '\x1b';
  if (key === '\\' || key === '4') return '\x1c';
  if (key === ']' || key === '5') return '\x1d';
  if (key === '^' || key === '6') return '\x1e';
  if (key === '_' || key === '-' || key === '/' || key === '7') return '\x1f';
  if (key === '?' || key === '8') return '\x7f';
  if (/^[a-z]$/i.test(key)) return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
  return null;
}

/** xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
function modifierParam(event: KeyEventLike): number {
  return 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
}

/** Bytes for a terminal, or null for keys the terminal must not receive (modifier-only, Cmd combos, unmapped). */
export function keyEventToTerminalBytes(
  event: KeyEventLike,
  options: KeyMapOptions = {},
): string | null {
  const { key } = event;
  if (event.metaKey || isModifierOnlyKey(key)) return null;
  const mod = modifierParam(event);
  const modified = mod > 1;

  const cursorFinal = CURSOR_FINALS[key];
  if (cursorFinal) {
    if (modified) return `\x1b[1;${mod}${cursorFinal}`;
    return `${options.applicationCursor ? '\x1bO' : '\x1b['}${cursorFinal}`;
  }

  const tilde = TILDE_CODES[key];
  if (tilde !== undefined) return modified ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`;

  const ss3 = SS3_FUNCTION_FINALS[key];
  if (ss3) return modified ? `\x1b[1;${mod}${ss3}` : `\x1bO${ss3}`;

  if (key === 'Tab') {
    if (event.shiftKey && !event.ctrlKey && !event.altKey) return '\x1b[Z';
    return event.altKey ? '\x1b\t' : '\t';
  }

  const alt = event.altKey ? '\x1b' : '';
  if (key === 'Enter') return `${alt}\r`;
  if (key === 'Backspace') return `${alt}${event.ctrlKey ? '\x08' : '\x7f'}`;
  if (key === 'Escape') return `${alt}\x1b`;

  if ([...key].length !== 1) return null;
  if (event.ctrlKey && event.altKey && isAltGraph(event)) return key;
  if (event.ctrlKey) {
    const byte = controlByte(key) ?? controlByte(asciiFromCode(event.code, false) ?? '');
    return byte === null || !event.altKey ? byte : `\x1b${byte}`;
  }
  if (event.altKey) {
    const base = isAscii(key) ? key : asciiFromCode(event.code, event.shiftKey);
    return base === null ? key : `\x1b${base}`;
  }
  return key;
}

/** Short label such as "Enter", "a" or "Ctrl+C" for the last-key indicator. */
export function describeKey(event: KeyEventLike): string {
  const name = event.key === ' ' ? 'Space' : event.key;
  if (isModifierOnlyKey(event.key)) return name;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Cmd');
  if (event.shiftKey && (name.length > 1 || parts.length > 0)) parts.push('Shift');
  const modified = parts.length > 0;
  parts.push(modified && name.length === 1 ? name.toUpperCase() : name);
  return parts.join('+');
}
