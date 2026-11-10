import { describe, expect, it } from 'vitest';
import {
  BUTTON_FUNCTIONS,
  DEFAULT_BUTTON_MAP,
  nextButtonFunction,
  validateButtonMap,
} from '../src/workspace/controller-buttons';

describe('controller button map', () => {
  it('defaults to right A Menu, right B Focus, left X Panes and left Y Nothing', () => {
    expect(validateButtonMap(undefined)).toEqual({
      rightA: 'menu',
      rightB: 'focus',
      leftX: 'panes',
      leftY: 'none',
    });
  });

  it('keeps known functions and replaces unknown ones with the default', () => {
    expect(validateButtonMap({ leftY: 'warp', rightA: 'explode', extra: 'menu' })).toEqual({
      ...DEFAULT_BUTTON_MAP,
      leftY: 'warp',
    });
  });

  it('cycles through every function and wraps', () => {
    let choice = BUTTON_FUNCTIONS[0];
    const seen = new Set([choice]);
    for (let step = 1; step < BUTTON_FUNCTIONS.length; step++) {
      choice = nextButtonFunction(choice);
      seen.add(choice);
    }
    expect(seen.size).toBe(BUTTON_FUNCTIONS.length);
    expect(nextButtonFunction(choice)).toBe(BUTTON_FUNCTIONS[0]);
  });
});
