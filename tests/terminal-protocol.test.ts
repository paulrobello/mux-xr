import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import {
  createInputMessage,
  decodeServerMessage,
  encodeClientMessage,
} from '../src/terminal/protocol';
import { paneWebSocketURL, terminalKeyBytes } from '../src/terminal/surface';
import {
  ClientMessageSchema,
  ConnectedSchema,
  InputSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

describe('terminal protocol framing', () => {
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
