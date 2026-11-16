import { describe, expect, it } from 'vitest';
import { getControlHelp, getControlHelpFor, getKeyHelp, HELP } from '../src/control-help';
import type { PanelAction } from '../src/xr/panel-actions';

/** Actions whose help may name clocks: the clock widget's own close button. */
const CLOCK_ACTIONS = new Set<string>(['closeWidget']);

/** A sample payload per action so function entries run against a realistic value. */
const SAMPLE: Partial<Record<PanelAction['type'], Record<string, unknown>>> = {
  openInput: { mode: 'widgets' },
  radialAction: { radialAction: 'focus' },
  key: { key: 'Enter' },
  zipDigit: { zipDigit: '7' },
  background: { background: 'aurora' },
  arrange: { pattern: 'row' },
};

const sampleAction = (type: PanelAction['type']): PanelAction =>
  ({ type, ...SAMPLE[type] }) as PanelAction;

describe('control help table', () => {
  const types = Object.keys(HELP) as Array<PanelAction['type']>;

  it('covers every action with a string, a derived string, or an explicit null', () => {
    expect(types.length).toBeGreaterThan(90);
    for (const type of types) {
      const entry = HELP[type] as unknown;
      expect(
        entry === null || typeof entry === 'string' || typeof entry === 'function',
        `${type} has no help entry`,
      ).toBe(true);
      const text = getControlHelp(sampleAction(type));
      expect(text === undefined || (typeof text === 'string' && text.length > 0), type).toBe(true);
      if (entry === null) expect(text, `${type} should be silent`).toBeUndefined();
    }
  });

  it('keeps clock wording to the clock widget controls', () => {
    for (const type of types) {
      if (CLOCK_ACTIONS.has(type)) continue;
      const text = getControlHelp(sampleAction(type));
      if (text)
        expect(text.toLowerCase(), `${type} help mentions a clock`).not.toMatch(/\bclock\b/);
    }
  });

  it('describes the widget toggle and the widgets entry point generically', () => {
    expect(getControlHelp({ type: 'toggleWidget' })).toBe('Show or hide this widget');
    expect(getControlHelp({ type: 'openInput', mode: 'widgets' })).toBe(
      'Open movable widgets: clocks, weather, timer, performance, pictures, boards and diagnostics',
    );
  });

  it('picks payload-dependent text', () => {
    expect(getControlHelp({ type: 'layoutDepth', direction: -1 })).toBe(
      'Move all terminals closer; keep sizes',
    );
    expect(getControlHelp({ type: 'layoutDepth', direction: 1 })).toBe(
      'Move all terminals farther; keep sizes',
    );
    expect(getControlHelp({ type: 'dictation', dictationAction: 'stop' })).toBe(
      'Stop listening and review the transcript',
    );
    expect(getControlHelp({ type: 'dictation' })).toBe(
      'Use browser speech recognition, then review before inserting',
    );
    expect(getControlHelp({ type: 'openInput', mode: 'settings' })).toBe(
      'Open display, world and selected-terminal settings',
    );
    expect(getControlHelp({ type: 'openInput', mode: 'warp' })).toBe('Open saved quick commands');
  });

  it('answers for no action and for silent controls with undefined', () => {
    expect(getControlHelp(undefined)).toBeUndefined();
    expect(getControlHelp({ type: 'noop' })).toBeUndefined();
    expect(getControlHelp({ type: 'grabWidget' })).toBeUndefined();
  });

  it('reads keyboard keys and bare inputAction bags through getControlHelpFor', () => {
    expect(getControlHelpFor({ inputAction: 'key', key: 'Enter' })).toBe(getKeyHelp('Enter'));
    expect(getControlHelpFor({ inputAction: 'close' })).toBe('Close this panel');
    expect(getControlHelpFor({ inputAction: 'prototypeRadial' })).toBeUndefined();
    expect(getControlHelpFor({})).toBeUndefined();
  });
});
