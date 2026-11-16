import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTIC_CAPACITY,
  diagnostics,
  errorName,
  redact,
  reportSwallowed,
  swallowTo,
} from '../src/diagnostics';

beforeEach(() => diagnostics.clear());
afterEach(() => vi.restoreAllMocks());

describe('diagnostics log', () => {
  it('stores the Error class and message under its scope, newest first', () => {
    diagnostics.report('pictures.delete', new TypeError('write failed'));
    const [entry] = diagnostics.entries();
    expect(entry).toMatchObject({
      scope: 'pictures.delete',
      name: 'TypeError',
      message: 'write failed',
      count: 1,
    });
    expect(diagnostics.entries()).toHaveLength(1);
  });

  it('stores a non-Error as its String form without a name', () => {
    diagnostics.report('host.clipboard', 'refused');
    expect(diagnostics.entries()[0]).toMatchObject({ name: '', message: 'refused', count: 1 });
  });

  it('keeps only the newest capacity entries, dropping the oldest', () => {
    for (let index = 0; index < DIAGNOSTIC_CAPACITY + 5; index += 1)
      diagnostics.report(`scope.${index}`, new Error(`failure ${index}`));
    const entries = diagnostics.entries();
    expect(entries).toHaveLength(DIAGNOSTIC_CAPACITY);
    expect(entries[0]?.scope).toBe(`scope.${DIAGNOSTIC_CAPACITY + 4}`);
    expect(entries.at(-1)?.scope).toBe('scope.5');
  });

  it('collapses a repeat of the newest entry into a count instead of a row', () => {
    diagnostics.report('render.frame', new Error('context lost'));
    diagnostics.report('render.frame', new Error('context lost'));
    diagnostics.report('render.frame', new Error('context lost'));
    const entries = diagnostics.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ count: 3, name: 'Error', message: 'context lost' });
    // A different message adds a row even under the same scope.
    diagnostics.report('render.frame', new Error('different'));
    expect(diagnostics.entries()).toHaveLength(2);
  });

  it('redacts a query string, a fragment and a 32-character hex run', () => {
    expect(redact('https://host.example/path?token=secret#frag')).toBe('https://host.example/path');
    expect(redact('Request to https://host.example/p?token=secret failed')).toBe(
      'Request to https://host.example/p failed',
    );
    expect(redact(`row ${'a'.repeat(32)} stalled`)).toBe('row [redacted] stalled');
    expect(redact('short message stays')).toBe('short message stays');
  });

  it('truncates stored messages to 200 characters after redaction', () => {
    diagnostics.report('long.message', new Error('word '.repeat(50)));
    expect(diagnostics.entries()[0]?.message).toHaveLength(200);
    expect(diagnostics.entries()[0]?.message.endsWith('…')).toBe(true);
    diagnostics.clear();
    // A token-like run never enters the log, however long the message was.
    diagnostics.report('token.message', new Error('x'.repeat(400)));
    expect(diagnostics.entries()[0]?.message).toBe('[redacted]');
  });

  it('clear empties the ring and notifies; a subscriber is called once per report', () => {
    const listener = vi.fn();
    const stop = diagnostics.subscribe(listener);
    diagnostics.report('a', new Error('one'));
    diagnostics.report('b', new Error('two'));
    expect(listener).toHaveBeenCalledTimes(2);
    diagnostics.report('b', new Error('two'));
    expect(listener).toHaveBeenCalledTimes(3);
    diagnostics.clear();
    expect(diagnostics.entries()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    diagnostics.report('c', new Error('three'));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('reports a swallowed error through console.debug with its scope and into the log', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = new Error('boom');
    reportSwallowed('pictures.delete', error);
    expect(debug).toHaveBeenCalledWith('[mux-xr] pictures.delete', error);
    expect(diagnostics.entries()[0]).toMatchObject({ scope: 'pictures.delete', count: 1 });
  });

  it('reduces an error to its class name for server logs', () => {
    expect(errorName(new TypeError('/private/path'))).toBe('TypeError');
    expect(errorName('plain string')).toBe('unknown');
  });

  it('resolves a rejected promise to the fallback and reports the cause once', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = new Error('write failed');
    await expect(Promise.reject(error).catch(swallowTo('library.update', false))).resolves.toBe(
      false,
    );
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith('[mux-xr] library.update', error);
  });
});
