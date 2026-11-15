import { describe, expect, it } from 'vitest';
import { classifyServerParam } from '../src/server-param';

describe('classifyServerParam', () => {
  it('connects when the parameter names the page host', () => {
    expect(classifyServerParam('http://127.0.0.1:4241', '127.0.0.1:4241', '')).toBe('connect');
  });

  it('connects when the parameter names the saved endpoint host', () => {
    expect(
      classifyServerParam(
        'ws://mac.local:4243/other',
        '127.0.0.1:4241',
        'wss://mac.local:4243/stream',
      ),
    ).toBe('connect');
  });

  it('prefills a foreign host', () => {
    expect(classifyServerParam('wss://evil.example/stream', '127.0.0.1:4241', '')).toBe('prefill');
  });

  it('prefills a malformed value', () => {
    expect(classifyServerParam('http://[::1', '127.0.0.1:4241', '')).toBe('prefill');
  });

  it('prefills a different port on the page host', () => {
    expect(classifyServerParam('wss://127.0.0.1:9/stream', '127.0.0.1:4241', '')).toBe('prefill');
  });
});
