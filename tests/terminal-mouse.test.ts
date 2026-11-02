import { fromBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import type { TerminalMouseInput } from '../src/contracts';
import { createMouseMessage, encodeClientMessage } from '../src/terminal/protocol';
import { ClientMessageSchema } from '../src/terminal/vendor/terminal_pb';

function decodeMouse(input: TerminalMouseInput) {
  const frame = encodeClientMessage(createMouseMessage(input));
  const message = fromBinary(ClientMessageSchema, new Uint8Array(frame).slice(1));
  if (message.message.case !== 'mouse') throw new Error('expected mouse message');
  return message.message.value;
}

describe('terminal mouse protocol', () => {
  it('encodes coordinates, modifiers, and xterm motion bit', () => {
    expect(
      decodeMouse({
        col: 12,
        row: 7,
        button: 1,
        eventType: 'move',
        modifiers: { shift: true, ctrl: true },
      }),
    ).toMatchObject({
      col: 12,
      row: 7,
      button: 33,
      eventType: 'move',
      shift: true,
      ctrl: true,
      alt: false,
    });
  });

  it('keeps release button numbers unmodified', () => {
    expect(decodeMouse({ col: 0, row: 0, button: 0, eventType: 'release' })).toMatchObject({
      button: 0,
      eventType: 'release',
    });
  });
});
