import { describe, expect, it } from 'vitest';
import {
  createModifierState,
  keyboardDimensions,
  keyboardKeys,
  semanticKeyboardLayout,
} from '../src/keyboard';

describe('shared keyboard layout', () => {
  it('uses a normal keyboard arrangement with separated inverted-T arrows', () => {
    expect(keyboardDimensions).toEqual({ width: 19, height: 6 });
    expect(keyboardKeys.find((key) => key.key === 'Backspace')).toMatchObject({
      x: 13,
      y: 1,
      width: 2,
    });
    expect(keyboardKeys.find((key) => key.key === 'Tab')).toMatchObject({ x: 0, y: 2 });
    expect(keyboardKeys.find((key) => key.key === 'Enter')).toMatchObject({ x: 12.5, y: 3 });
    expect(keyboardKeys.filter((key) => key.key.startsWith('Arrow'))).toHaveLength(4);
    expect(semanticKeyboardLayout.flat().map((key) => key.key)).toContain(' ');
  });
});

describe('modifier state', () => {
  it('keeps locked modifiers through consumption and clears one-shot modifiers', () => {
    const modifiers = createModifierState();
    modifiers.tap('shift');
    modifiers.lock('ctrl');
    modifiers.consume();
    expect(modifiers.active).toEqual({ ctrl: true });
    expect(modifiers.locked).toEqual({ ctrl: true });
    modifiers.tap('ctrl');
    expect(modifiers.active).toEqual({});
    expect(modifiers.locked).toEqual({});
  });
});
