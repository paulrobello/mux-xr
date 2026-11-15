import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorName, reportSwallowed, swallowTo } from '../src/diagnostics';

afterEach(() => vi.restoreAllMocks());

describe('diagnostics', () => {
  it('reports a swallowed error through console.debug with its scope', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = new Error('boom');
    reportSwallowed('pictures.delete', error);
    expect(debug).toHaveBeenCalledWith('[mux-xr] pictures.delete', error);
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
