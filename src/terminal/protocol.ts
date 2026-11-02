import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import * as pako from 'pako';
import type { TerminalMouseInput } from '../contracts';
import {
  type ClientMessage,
  ClientMessageSchema,
  ClientResizeSchema,
  FocusChangeSchema,
  InputSchema,
  MouseInputSchema,
  PasteInputSchema,
  PingSchema,
  RequestRefreshSchema,
  type ServerMessage,
  ServerMessageSchema,
} from './vendor/terminal_pb';

export type { ClientMessage, ServerMessage } from './vendor/terminal_pb';

// Match the core streaming protocol's bounded 9 MiB payload contract.
const MAX_DECOMPRESSED_SIZE = 9 * 1024 * 1024;
const MAX_COMPRESSED_SIZE = MAX_DECOMPRESSED_SIZE;

/** Returns the US-layout printable character represented by a key and Shift state. */
export function terminalKeyLabel(key: string, shift = false): string {
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

export function encodeClientMessage(message: ClientMessage): ArrayBuffer {
  const payload = toBinary(ClientMessageSchema, message);
  if (payload.length > 256) {
    const compressed = pako.deflate(payload);
    if (compressed.length < payload.length) {
      const result = new Uint8Array(compressed.length + 1);
      result[0] = 1;
      result.set(compressed, 1);
      return result.buffer as ArrayBuffer;
    }
  }
  const result = new Uint8Array(payload.length + 1);
  result.set(payload, 1);
  return result.buffer as ArrayBuffer;
}

export function decodeServerMessage(data: ArrayBuffer): ServerMessage {
  const bytes = new Uint8Array(data);
  if (bytes.length < 2) throw new Error('Empty message');
  let payload = bytes.slice(1);
  if (bytes[0] !== 0 && bytes[0] !== 1) throw new Error('Unsupported compression flag');
  if (bytes[0] === 1) {
    if (payload.length > MAX_COMPRESSED_SIZE) throw new Error('Compressed payload too large');
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inflator = new pako.Inflate();
    inflator.onData = (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > MAX_DECOMPRESSED_SIZE) throw new Error('Decompressed payload too large');
      chunks.push(chunk);
    };
    inflator.push(payload, true);
    if (inflator.err) throw new Error(inflator.msg || 'Invalid compressed payload');
    payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
  }
  if (payload.length > MAX_DECOMPRESSED_SIZE) throw new Error('Payload too large');
  return fromBinary(ServerMessageSchema, payload);
}

export function createInputMessage(data: string): ClientMessage {
  return create(ClientMessageSchema, {
    message: {
      case: 'input',
      value: create(InputSchema, { data: new TextEncoder().encode(data) }),
    },
  });
}

export function createMouseMessage(input: TerminalMouseInput): ClientMessage {
  const modifiers = input.modifiers ?? {};
  // The mux core consumes xterm's button encoding. Motion is bit 5, while
  // release is represented by the event type and keeps the button number.
  const button = input.eventType === 'move' ? input.button | 32 : input.button;
  return create(ClientMessageSchema, {
    message: {
      case: 'mouse',
      value: create(MouseInputSchema, {
        col: input.col,
        row: input.row,
        button,
        shift: modifiers.shift ?? false,
        ctrl: modifiers.ctrl ?? false,
        alt: modifiers.alt ?? false,
        eventType: input.eventType,
      }),
    },
  });
}

export function createPasteMessage(content: string): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'paste', value: create(PasteInputSchema, { content }) },
  });
}

export function createResizeMessage(cols: number, rows: number): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'resize', value: create(ClientResizeSchema, { cols, rows }) },
  });
}

export function createFocusMessage(focused: boolean): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'focus', value: create(FocusChangeSchema, { focused }) },
  });
}

export function createPingMessage(): ClientMessage {
  return create(ClientMessageSchema, { message: { case: 'ping', value: create(PingSchema, {}) } });
}

export function createRefreshMessage(): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'refresh', value: create(RequestRefreshSchema, {}) },
  });
}
