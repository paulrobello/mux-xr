/**
 * Dependency-free keyboard types shared by the host service side and the XR keyboard: no `three`
 * import, so the Node host service and contracts can load this file.
 */

export interface KeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type KeyboardModifier = keyof KeyModifiers;

/** Returns the US-layout printable character represented by a key and Shift state. */
export function keyboardKeyLabel(key: string, shift = false): string {
  if (key.length !== 1 || !shift) return key.length === 1 ? key.toLowerCase() : key;
  const shifted: Record<string, string> = {
    '`': '~',
    '1': '!',
    '2': '@',
    '3': '#',
    '4': '$',
    '5': '%',
    '6': '^',
    '7': '&',
    '8': '*',
    '9': '(',
    '0': ')',
    '-': '_',
    '=': '+',
    '[': '{',
    ']': '}',
    ';': ':',
    "'": '"',
    '\\': '|',
    ',': '<',
    '.': '>',
    '/': '?',
  };
  return shifted[key] ?? key.toUpperCase();
}
