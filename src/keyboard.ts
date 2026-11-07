import type { KeyModifiers } from './contracts';

export type KeyboardModifier = keyof KeyModifiers;

export interface SemanticKey {
  readonly label: string;
  readonly key: string;
  readonly modifier?: KeyboardModifier;
}

export interface PositionedKey extends SemanticKey {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const key = (
  label: string,
  value: string,
  x: number,
  y: number,
  width = 1,
  modifier?: KeyboardModifier,
): PositionedKey => ({
  label,
  key: value,
  x,
  y,
  width,
  height: 1,
  ...(modifier ? { modifier } : {}),
});

const mainRows: readonly (readonly PositionedKey[])[] = [
  [key('Esc', 'Escape', 0, 0)],
  [
    ...['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].map((value, index) =>
      key(value, value, index, 1),
    ),
    key('⌫', 'Backspace', 13, 1, 2),
  ],
  [
    key('Tab', 'Tab', 0, 2, 1.5),
    ...['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'].map((label, index) =>
      key(label, label.toLowerCase(), 1.5 + index, 2),
    ),
    key('\\', '\\', 13.5, 2, 1.5),
  ],
  [
    ...['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"].map((label, index) =>
      key(label, label.toLowerCase(), 1.5 + index, 3),
    ),
    key('Enter', 'Enter', 12.5, 3, 2.5),
  ],
  [
    key('Shift', 'Shift', 0, 4, 2, 'shift'),
    ...['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'].map((label, index) =>
      key(label, label.toLowerCase(), 2 + index, 4),
    ),
    key('Shift', 'Shift', 12, 4, 3, 'shift'),
  ],
  [
    key('Ctrl', 'Control', 0, 5, 1.5, 'ctrl'),
    key('Alt', 'Alt', 1.5, 5, 1.5, 'alt'),
    key('Space', ' ', 3, 5, 9),
    key('Alt', 'Alt', 12, 5, 1.5, 'alt'),
    key('Ctrl', 'Control', 13.5, 5, 1.5, 'ctrl'),
  ],
];

const navigationRows: readonly PositionedKey[] = [
  key('↑', 'ArrowUp', 17, 4),
  key('←', 'ArrowLeft', 16, 5),
  key('↓', 'ArrowDown', 17, 5),
  key('→', 'ArrowRight', 18, 5),
  key('Ins', 'Insert', 16, 2),
  key('Home', 'Home', 17, 2),
  key('PgUp', 'PageUp', 18, 2),
  key('Del', 'Delete', 16, 3),
  key('End', 'End', 17, 3),
  key('PgDn', 'PageDown', 18, 3),
];

export const keyboardKeys: readonly PositionedKey[] = [...mainRows.flat(), ...navigationRows];
export const keyboardDimensions = { width: 19, height: 6 } as const;
export const semanticKeyboardLayout: readonly (readonly SemanticKey[])[] = [
  ...mainRows,
  navigationRows,
];

export interface ModifierState {
  readonly active: Readonly<KeyModifiers>;
  readonly locked: Readonly<KeyModifiers>;
  tap(name: KeyboardModifier): void;
  lock(name: KeyboardModifier): void;
  restore(name: KeyboardModifier, wasActive: boolean, wasLocked: boolean): void;
  consume(): void;
  clear(): void;
}

export function createModifierState(): ModifierState {
  const active: KeyModifiers = {};
  const locked: KeyModifiers = {};
  const copy = (value: KeyModifiers): Readonly<KeyModifiers> => Object.freeze({ ...value });
  const state: ModifierState = {
    get active() {
      return copy(active);
    },
    get locked() {
      return copy(locked);
    },
    tap(name) {
      if (locked[name]) {
        delete locked[name];
        delete active[name];
        return;
      }
      active[name] = !active[name];
    },
    lock(name) {
      locked[name] = true;
      active[name] = true;
    },
    restore(name, wasActive, wasLocked) {
      if (wasActive) active[name] = true;
      else delete active[name];
      if (wasLocked) locked[name] = true;
      else delete locked[name];
    },
    consume() {
      for (const name of ['ctrl', 'alt', 'shift'] as const) {
        if (!locked[name]) delete active[name];
      }
    },
    clear() {
      for (const name of ['ctrl', 'alt', 'shift'] as const) {
        delete active[name];
        delete locked[name];
      }
    },
  };
  return state;
}
