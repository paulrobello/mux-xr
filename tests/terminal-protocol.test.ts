import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { deflate } from 'pako';
import { describe, expect, it } from 'vitest';
import {
  createInputMessage,
  decodeServerMessage,
  encodeClientMessage,
  terminalKeyLabel,
} from '../src/terminal/protocol';
import { paneWebSocketURL, terminalKeyBytes } from '../src/terminal/surface';
import {
  ClientMessageSchema,
  ConnectedSchema,
  InputSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

describe('terminal protocol framing', () => {
  function screenFrame(screen: Uint8Array, compressed: boolean): ArrayBuffer {
    const message = create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, { cols: 149, rows: 54, initialScreen: screen }),
      },
    });
    const payload = toBinary(ServerMessageSchema, message);
    const bytes = compressed ? deflate(payload) : payload;
    const frame = new Uint8Array(bytes.length + 1);
    frame[0] = compressed ? 1 : 0;
    frame.set(bytes, 1);
    return frame.buffer;
  }

  it.each([false, true])('accepts a large scrollback seed with compression=%s', (compressed) => {
    const screen = new TextEncoder().encode('monitor output\r\n'.repeat(180_000));
    const message = decodeServerMessage(screenFrame(screen, compressed));
    expect(message.message.case).toBe('connected');
    if (message.message.case !== 'connected') throw new Error('expected connected');
    expect(message.message.value.initialScreen).toEqual(screen);
  });

  it('accepts a compressed seed above the former 256 KiB wire limit', () => {
    const screen = new Uint8Array(512 * 1024);
    let state = 123456789;
    for (let index = 0; index < screen.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      screen[index] = state & 255;
    }
    const frame = screenFrame(screen, true);
    expect(frame.byteLength).toBeGreaterThan(256 * 1024);
    const message = decodeServerMessage(frame);
    if (message.message.case !== 'connected') throw new Error('expected connected');
    expect(message.message.value.initialScreen).toEqual(screen);
  });

  it.each([false, true])('retains the hard 9 MiB bound with compression=%s', (compressed) => {
    const limit = 9 * 1024 * 1024;
    const overhead = screenFrame(new Uint8Array(limit), false).byteLength - 1 - limit;
    const accepted = screenFrame(new Uint8Array(limit - overhead), compressed);
    const decoded = decodeServerMessage(accepted);
    if (decoded.message.case !== 'connected') throw new Error('expected connected');
    expect(decoded.message.value.initialScreen?.length).toBe(limit - overhead);
    expect(() =>
      decodeServerMessage(screenFrame(new Uint8Array(limit - overhead + 1), compressed)),
    ).toThrow(/payload too large/i);
  });

  it('round-trips an uncompressed client input through generated protobuf', () => {
    const frame = encodeClientMessage(createInputMessage('echo hi'));
    expect(new Uint8Array(frame)[0]).toBe(0);
    const message = fromBinary(ClientMessageSchema, new Uint8Array(frame).slice(1));
    expect(message.message.case).toBe('input');
    if (message.message.case !== 'input') throw new Error('expected input');
    expect(new TextDecoder().decode(message.message.value.data)).toBe('echo hi');
  });

  it('compresses large payloads and decodes connected initialScreen', () => {
    const input = create(ClientMessageSchema, {
      message: {
        case: 'input',
        value: create(InputSchema, { data: new TextEncoder().encode('x'.repeat(5000)) }),
      },
    });
    const frame = encodeClientMessage(input);
    expect(new Uint8Array(frame)[0]).toBe(1);
    const connected = create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 80,
          rows: 24,
          initialScreen: new TextEncoder().encode('\x1b[2Jseed'),
        }),
      },
    });
    const payload = toBinary(ServerMessageSchema, connected);
    const serverFrame = new Uint8Array(payload.length + 1);
    serverFrame.set(payload, 1);
    const decoded = decodeServerMessage(serverFrame.buffer);
    expect(decoded.message.case).toBe('connected');
    if (decoded.message.case !== 'connected') throw new Error('expected connected');
    expect(new TextDecoder().decode(decoded.message.value.initialScreen)).toContain('seed');
  });
});

describe('terminal key bytes', () => {
  it('maps control and application cursor keys', () => {
    expect(terminalKeyBytes('c', { ctrl: true })).toBe('\x03');
    expect(terminalKeyBytes('a')).toBe('a');
    expect(terminalKeyBytes('a', { shift: true })).toBe('A');
    expect(terminalKeyBytes('1', { shift: true })).toBe('!');
    expect(terminalKeyBytes('/', { shift: true, alt: true })).toBe('\x1b?');
    expect(terminalKeyBytes('ArrowUp')).toBe('\x1b[A');
    expect(terminalKeyBytes('ArrowUp', {}, true)).toBe('\x1bOA');
    expect(terminalKeyBytes('ArrowUp', { alt: true })).toBe('\x1b[1;3A');
    expect(terminalKeyBytes('Delete', { ctrl: true })).toBe('\x1b[3;5~');
    expect(terminalKeyBytes('ArrowUp', { alt: true }, true)).toBe('\x1b[1;3A');
  });

  it('labels US printable keys for the visible keyboard', () => {
    expect(terminalKeyLabel('a')).toBe('a');
    expect(terminalKeyLabel('a', true)).toBe('A');
    expect(terminalKeyLabel('4', true)).toBe('$');
    expect(terminalKeyLabel('/', true)).toBe('?');
    expect(terminalKeyLabel('ArrowUp', true)).toBe('ArrowUp');
  });
});

describe('pane endpoint', () => {
  it('normalizes typed pane ids and rejects ambiguous ids', () => {
    expect(paneWebSocketURL('http://127.0.0.1:9000', '3')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
    expect(paneWebSocketURL('http://127.0.0.1:9000', '%3')).toBe(
      'ws://127.0.0.1:9000/ws?session=pane-3',
    );
    expect(() => paneWebSocketURL('http://127.0.0.1:9000', 'pane-main')).toThrow('Invalid pane id');
  });
});
