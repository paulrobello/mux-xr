/** Brands that mark HEVC-coded HEIF (what iPhones and most Android phones write as .heic). */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);

/**
 * True when `bytes` open with an ISO-BMFF `ftyp` box naming an HEVC HEIF brand. A file with only
 * the generic `mif1`/`msf1` brands may use any codec, so it is left to the browser, which keeps
 * libheif's uncompressed, overlay and other codec paths out of reach.
 */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const ascii = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (ascii(4) !== 'ftyp') return false;
  const size = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  if (size < 16) return false;
  const end = Math.min(size, bytes.length);
  const brands = [ascii(8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(at));
  return brands.some((brand) => HEVC_BRANDS.has(brand));
}
