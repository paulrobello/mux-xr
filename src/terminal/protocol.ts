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

export { keyboardKeyLabel as terminalKeyLabel } from '@par/xr-workspace/keyboard-types';

/**
 * Frames a client message for the wire: one flag byte (`1` deflated, `0` raw) then the protobuf
 * payload. Payloads over 256 bytes are deflated only when that makes them smaller.
 */
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

/**
 * Reads a server frame written by `encodeClientMessage`'s framing. Throws on an empty frame, an
 * unknown flag byte, or a payload above 9 MiB compressed or decompressed.
 */
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

/** Keystroke input. The text is sent as UTF-8 bytes without sanitizing. */
export function createInputMessage(data: string): ClientMessage {
  return create(ClientMessageSchema, {
    message: {
      case: 'input',
      value: create(InputSchema, { data: new TextEncoder().encode(data) }),
    },
  });
}

/** A mouse report. `move` events set the motion bit (32) on the button code. */
export function createMouseMessage(input: TerminalMouseInput): ClientMessage {
  const modifiers = input.modifiers ?? {};
  // Raw SGR uses bit 5 for motion and bit 6 for wheels. Releases
  // keep the button number and use the event type instead.
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

/**
 * Strips every C0/C1 control character (ESC included, so a payload cannot close the
 * terminal's bracketed-paste envelope early) while keeping tab, LF and CR. The terminal
 * core wraps the remaining text in its own paste markers, so any control byte a web page
 * plants in the clipboard would otherwise reach the shell as typed input.
 */
export function sanitizePasteContent(content: string): string {
  let clean = '';
  for (const char of content) {
    const code = char.codePointAt(0) ?? 0;
    const kept =
      code === 9 || code === 10 || code === 13 || (code >= 32 && (code < 0x7f || code > 0x9f));
    if (kept) clean += char;
  }
  return clean;
}

/** A bracketed paste. The content is passed through `sanitizePasteContent` first. */
export function createPasteMessage(content: string): ClientMessage {
  return create(ClientMessageSchema, {
    message: {
      case: 'paste',
      value: create(PasteInputSchema, { content: sanitizePasteContent(content) }),
    },
  });
}

/** A request to resize the remote grid, in cells. The server's confirmed size is authoritative. */
export function createResizeMessage(cols: number, rows: number): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'resize', value: create(ClientResizeSchema, { cols, rows }) },
  });
}

/** Reports whether this viewer's terminal has focus. */
export function createFocusMessage(focused: boolean): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'focus', value: create(FocusChangeSchema, { focused }) },
  });
}

/** A keepalive ping, used to time the stream round trip. */
export function createPingMessage(): ClientMessage {
  return create(ClientMessageSchema, { message: { case: 'ping', value: create(PingSchema, {}) } });
}

/** Asks the server to resend the screen. */
export function createRefreshMessage(): ClientMessage {
  return create(ClientMessageSchema, {
    message: { case: 'refresh', value: create(RequestRefreshSchema, {}) },
  });
}
