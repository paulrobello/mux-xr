import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sanitizePasteContent } from '../../src/terminal/protocol';
import { propertyOptions, unicodeStrings } from './fc-options';

/** A control the sanitizer must remove: C0 minus tab/LF/CR, plus DEL and the C1 range. */
const isStrippedCode = (code: number): boolean =>
  code <= 8 ||
  code === 11 ||
  code === 12 ||
  (code >= 14 && code <= 31) ||
  code === 127 ||
  (code >= 0x80 && code <= 0x9f);

const hasStrippedCode = (text: string): boolean => {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isStrippedCode(code)) return true;
  }
  return false;
};

/** ESC, CSI introducers and both bracketed-paste markers spliced into arbitrary positions. */
const escapeMarkers = ['\u001b', '\u001b[', '\u001b[201~', '\u001b[?2004h'] as const;
const spliceMarker = fc
  .tuple(unicodeStrings({ maxLength: 128 }), fc.nat(escapeMarkers.length - 1), fc.nat(64))
  .map(([base, which, at]) => {
    const codePoints = Array.from(base);
    codePoints.splice(Math.min(at, codePoints.length), 0, escapeMarkers[which]);
    return codePoints.join('');
  });

const cleanStrings = fc
  .array(fc.constantFrom(...Array.from('aB9\t\nc\r dEf é✓漢字~[;.')), { maxLength: 128 })
  .map((chars) => chars.join(''));

describe('sanitizePasteContent properties', () => {
  it('strips every banned control from arbitrary strings and marker-spliced strings', async () => {
    await fc.assert(
      fc.property(unicodeStrings({ maxLength: 256 }), (text) => {
        expect(hasStrippedCode(sanitizePasteContent(text))).toBe(false);
      }),
      propertyOptions(),
    );
    await fc.assert(
      fc.property(spliceMarker, (text) => {
        expect(hasStrippedCode(sanitizePasteContent(text))).toBe(false);
      }),
      propertyOptions(),
    );
  });

  it('is idempotent', async () => {
    await fc.assert(
      fc.property(unicodeStrings({ maxLength: 256 }), (text) => {
        const once = sanitizePasteContent(text);
        expect(sanitizePasteContent(once)).toBe(once);
      }),
      propertyOptions(),
    );
  });

  it('is the identity on strings without banned controls', async () => {
    await fc.assert(
      fc.property(cleanStrings, (text) => {
        expect(sanitizePasteContent(text)).toBe(text);
      }),
      propertyOptions(),
    );
  });

  it('never emits a bracketed-paste end marker, even for inputs that contain one', async () => {
    await fc.assert(
      fc.property(spliceMarker, (text) => {
        expect(sanitizePasteContent(text)).not.toContain('\u001b[201~');
      }),
      propertyOptions(),
    );
  });
});
