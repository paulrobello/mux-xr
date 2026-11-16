import fc from 'fast-check';

/**
 * Shared fast-check options for the property tests. One seed per run of the suite: `FC_SEED`
 * wins when set, otherwise a fixed constant, so a gate failure is reproducible from the log.
 */
export const propertyOptions = (): { numRuns: 200; seed: number } => {
  const raw = process.env.FC_SEED;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return { numRuns: 200, seed: Number.isFinite(parsed) ? parsed : 20261116 };
};

/**
 * Strings over the whole code point space, lone surrogates included. fast-check 4 dropped
 * `fullUnicodeString`, so the code points come from an explicit integer arbitrary.
 */
export const unicodeStrings = (options: { maxLength: number }): fc.Arbitrary<string> =>
  fc
    .array(fc.nat(0x10ffff), options)
    .map((codePoints) => codePoints.map((cp) => String.fromCodePoint(cp)).join(''));
