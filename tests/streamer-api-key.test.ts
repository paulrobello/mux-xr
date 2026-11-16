import { beforeEach, describe, expect, it } from 'vitest';
import { redact } from '../src/diagnostics';
import { classifyServerParam } from '../src/server-param';
import { createSettingsStore, DEFAULT_SETTINGS, validateSettings } from '../src/settings/store';
import { paneWebSocketURL } from '../src/terminal/surface';
import { connectHierarchy, hierarchyURL } from '../src/workspace/hierarchy';
import { requestPaneCreate } from '../src/workspace/pane-create';

/**
 * Streamer API key shipping INERT: with no key configured every produced URL is byte-identical
 * to the pre-key builder output, and the key never reaches a share link, a notice or diagnostics.
 */

class MockSocket {
  static instances: MockSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: ArrayBuffer[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  send(): void {}
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function withLocation(): void {
  MockSocket.instances = [];
  (globalThis as Record<string, unknown>).WebSocket = MockSocket;
  (globalThis as Record<string, unknown>).location = {
    origin: 'http://localhost:4271',
    protocol: 'http:',
    href: 'http://localhost:4271/',
  };
  (globalThis as Record<string, unknown>).window = { location: globalThis.location };
}

beforeEach(withLocation);

describe('paneWebSocketURL streamer API key', () => {
  it('appends nothing when the key is unset, matching the pre-key output byte-for-byte', () => {
    expect(paneWebSocketURL('http://127.0.0.1:9000', '3')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
    expect(paneWebSocketURL('http://127.0.0.1:9000', '%3', undefined)).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
    expect(paneWebSocketURL('http://127.0.0.1:9000', '%3', '')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
    expect(paneWebSocketURL('http://127.0.0.1:9000/ws?metadata=1', '%3', '')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
  });

  it('appends an encoded api_key parameter when a key is set', () => {
    expect(paneWebSocketURL('http://127.0.0.1:9000', '3', 'secret-key')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3&api_key=secret-key',
    );
  });

  it('encodes special characters in the key', () => {
    const key = 'a&b=c d/e?f#hürst 鍵';
    const rendered = paneWebSocketURL('http://127.0.0.1:9000', '%3', key);
    expect(rendered.startsWith('ws://127.0.0.1:9000/ws?session=pane-3&api_key=')).toBe(true);
    const encodedValue = rendered.slice('ws://127.0.0.1:9000/ws?session=pane-3&api_key='.length);
    for (const raw of ['&', ' ', '=', '#']) expect(encodedValue).not.toContain(raw);
    expect(decodeURIComponent(encodedValue.replace(/\+/g, ' '))).toBe(key);
  });
});

describe('hierarchyURL streamer API key', () => {
  it('appends nothing when the key is unset, matching the pre-key output byte-for-byte', () => {
    expect(hierarchyURL('http://localhost:4241/ws?session=pane-3')).toBe(
      'ws://localhost:4241/ws?metadata=1',
    );
    expect(hierarchyURL('http://localhost:4241/ws', '')).toBe('ws://localhost:4241/ws?metadata=1');
    expect(hierarchyURL('http://localhost:4241/ws', undefined)).toBe(
      'ws://localhost:4241/ws?metadata=1',
    );
  });

  it('appends the api_key parameter when a key is set', () => {
    expect(hierarchyURL('http://localhost:4241/ws', 'secret-key')).toBe(
      'ws://localhost:4241/ws?metadata=1&api_key=secret-key',
    );
  });
});

describe('pane-create socket URL streamer API key', () => {
  it('carries the key only when set', async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const pending = requestPaneCreate('http://127.0.0.1:9000', '3', '$1', {
      apiKey: 'secret-key',
      socketFactory: (url) => {
        seen.push(url);
        return new MockSocket('');
      },
      signal: abort.signal,
    });
    abort.abort();
    await pending;
    expect(seen).toEqual(['ws://127.0.0.1:9000/ws?session=pane-3&api_key=secret-key']);
  });

  it('appends nothing when the key is unset', async () => {
    const seen: string[] = [];
    const abort = new AbortController();
    const pending = requestPaneCreate('http://127.0.0.1:9000', '3', '$1', {
      socketFactory: (url) => {
        seen.push(url);
        return new MockSocket('');
      },
      signal: abort.signal,
    });
    abort.abort();
    await pending;
    expect(seen).toEqual(['ws://127.0.0.1:9000/ws?session=pane-3']);
  });
});

describe('auth-failure surfacing', () => {
  it('names the API key in the connection notice when a key fails before open', async () => {
    withLocation();
    const errors: string[] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/ws',
      () => undefined,
      (message) => errors.push(message),
      undefined,
      'the-secret-key-value',
    );
    expect(MockSocket.instances).toHaveLength(1);
    MockSocket.instances[0].onerror?.();
    expect(errors).toEqual([
      'Cannot reach the streamer. Check the endpoint, its certificate, and the streamer API key.',
    ]);
    for (const message of errors) expect(message).not.toContain('the-secret-key-value');
    connection.disconnect();
  });

  it('keeps the plain notice when no key is configured', async () => {
    withLocation();
    const errors: string[] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/ws',
      () => undefined,
      (message) => errors.push(message),
    );
    MockSocket.instances[0].onerror?.();
    expect(errors).toEqual(['Cannot reach the streamer. Check its LAN address and certificate.']);
    connection.disconnect();
  });
});

describe('the key never reaches share links or notices', () => {
  it('classifies a ?server= link by host only, ignoring an api_key parameter', () => {
    expect(classifyServerParam('wss://host.local/ws?api_key=secret-key', 'other.host', '')).toBe(
      'prefill',
    );
    expect(classifyServerParam('wss://host.local/ws?api_key=secret-key', 'host.local', '')).toBe(
      'connect',
    );
  });

  it('leaves the only api_key-bearing producer to the URL builders asserted above', () => {
    // paneWebSocketURL, hierarchyURL and the pane-create factory capture are the only code
    // paths that append the key; each exact-string assertion above pins its whole output.
    expect(paneWebSocketURL('http://127.0.0.1:9000', '3', 'k').split('api_key')).toHaveLength(2);
    expect(hierarchyURL('http://localhost:4241/ws', 'k').split('api_key')).toHaveLength(2);
  });
});

describe('settings round-trip', () => {
  it('validateSettings trims the key and defaults to empty', () => {
    expect(validateSettings({ streamerApiKey: '  secret-key  ' }).streamerApiKey).toBe(
      'secret-key',
    );
    expect(validateSettings({}).streamerApiKey).toBe('');
    expect(validateSettings({ streamerApiKey: 42 }).streamerApiKey).toBe('');
    expect(validateSettings(DEFAULT_SETTINGS).streamerApiKey).toBe('');
  });

  it('survives a store update and persists through the validator', () => {
    const store = createSettingsStore();
    expect(store.get().streamerApiKey).toBe('');
    store.update({ streamerApiKey: ' rotated-key ' });
    expect(store.get().streamerApiKey).toBe('rotated-key');
  });
});

describe('diagnostics redaction', () => {
  it('redacts a query-string api_key value in a message passed through redact', () => {
    expect(redact('connect failed for https://host.local/ws?api_key=supersecretvalue123456')).toBe(
      'connect failed for https://host.local/ws',
    );
  });
});
