import { create, toBinary } from '@bufbuild/protobuf';
import fc from 'fast-check';
import { deflate } from 'pako';
import { describe, expect, it } from 'vitest';
import { decodeServerMessage } from '../../src/terminal/protocol';
import {
  ConnectedSchema,
  OutputSchema,
  type ServerMessage,
  ServerMessageSchema,
  TitleSchema,
} from '../../src/terminal/vendor/terminal_pb';
import { propertyOptions } from './fc-options';

/** Canonical byte form of a message: re-encoding makes round trips comparable without deep trees. */
const encoded = (message: ServerMessage): Uint8Array => toBinary(ServerMessageSchema, message);

const frame = (payload: Uint8Array, flag: 0 | 1): ArrayBuffer => {
  // Deflating a tiny payload can grow it (zlib header and checksum), so size by the body.
  const body = flag === 1 ? deflate(payload) : payload;
  const bytes = new Uint8Array(body.length + 1);
  bytes[0] = flag;
  bytes.set(body, 1);
  return bytes.buffer as ArrayBuffer;
};

/** Generated `ServerMessage` values over a small set of wire cases. */
const serverMessages = fc.oneof(
  fc
    .record({
      cols: fc.nat(500),
      rows: fc.nat(200),
      initialScreen: fc.uint8Array({ maxLength: 512 }),
      sessionId: fc.string({ maxLength: 40 }),
    })
    .map(({ cols, rows, initialScreen, sessionId }) =>
      create(ServerMessageSchema, {
        message: {
          case: 'connected',
          value: create(ConnectedSchema, { cols, rows, initialScreen, sessionId }),
        },
      }),
    ),
  fc.uint8Array({ maxLength: 512 }).map((data) =>
    create(ServerMessageSchema, {
      message: { case: 'output', value: create(OutputSchema, { data }) },
    }),
  ),
  fc.string({ maxLength: 120 }).map((title) =>
    create(ServerMessageSchema, {
      message: { case: 'title', value: create(TitleSchema, { title }) },
    }),
  ),
);

describe('decodeServerMessage properties', () => {
  // Any byte sequence is either a message or an Error; this also bounds a decoder hang.
  it('is total: any frame up to 4096 bytes returns a message or throws an Error', {
    timeout: 2000,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 4096 }), async (bytes) => {
        let decoded: ServerMessage | undefined;
        try {
          decoded = decodeServerMessage(bytes.buffer as ArrayBuffer);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        if (decoded !== undefined) expect(encoded(decoded)).toBeInstanceOf(Uint8Array);
      }),
      propertyOptions(),
    );
  });

  it('round trips generated messages for both compression flags', async () => {
    await fc.assert(
      fc.property(serverMessages, fc.constantFrom(0, 1), (message, flag) => {
        const decoded = decodeServerMessage(frame(encoded(message), flag));
        expect(encoded(decoded)).toEqual(encoded(message));
      }),
      propertyOptions(),
    );
  });

  it('throws on every frame whose inflated payload exceeds MAX_DECOMPRESSED_SIZE', {
    timeout: 20_000,
  }, async () => {
    // One generated repeat count per run; the compressed body is cached, since inflating past
    // the 9 MiB bound is the expensive part of an oversize run (~90 ms of inflate per run).
    // 15 runs instead of the suite's usual 200 keeps this test inside the suite's own time
    // budget even while the other suite files run in parallel workers.
    const oversize = new Map<number, ArrayBuffer>();
    const oversizeFrame = (repeat: number): ArrayBuffer => {
      const cached = oversize.get(repeat);
      if (cached) return cached;
      const payload = new Uint8Array(9 * 1024 * 1024 + 1 + repeat);
      const bytes = new Uint8Array(deflate(payload).length + 1);
      bytes[0] = 1;
      bytes.set(deflate(payload), 1);
      const built = bytes.buffer as ArrayBuffer;
      oversize.set(repeat, built);
      return built;
    };
    await fc.assert(
      fc.property(fc.nat(24), (repeat) => {
        expect(() => decodeServerMessage(oversizeFrame(repeat))).toThrow();
      }),
      { ...propertyOptions(), numRuns: 15 },
    );
  });
});
