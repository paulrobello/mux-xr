/** Longest texture edge a picture frame uploads; larger images are downscaled to fit. */
export const MAX_PICTURE_EDGE = 2048;
/** Largest source file or download accepted before decoding. */
export const MAX_PICTURE_SOURCE_BYTES = 40 * 1024 * 1024;
/** Largest decoded source edge; beyond this the decode itself is refused as oversized. */
export const MAX_PICTURE_SOURCE_EDGE = 16384;
/** Largest decoded source area (64 MP); a 16384 px edge alone still allows a huge square. */
export const MAX_PICTURE_SOURCE_PIXELS = 64 * 1024 * 1024;
/**
 * Largest file decoded when its header gives no size (an unknown format, or a JPEG frame header
 * past the probed bytes), since only the header lets an oversized image be refused undecoded.
 */
export const MAX_UNPROBED_PICTURE_BYTES = 8 * 1024 * 1024;
/** A URL fetch, body included, is aborted after this long so a hung server cannot stall picks. */
export const PICTURE_FETCH_TIMEOUT_MS = 20_000;
/** Long edge of a frame's image plane at scale 1, in metres. */
export const PICTURE_LONG_EDGE = 0.6;
/** Aspect ratio of the empty placeholder frame. */
export const PLACEHOLDER_ASPECT = 4 / 3;

export interface Size {
  width: number;
  height: number;
}

/** Scales `width` x `height` down (never up) so the long edge is at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge = MAX_PICTURE_EDGE): Size {
  if (!(width > 0 && height > 0)) throw new RangeError('Image has no size');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The image plane size in metres for an image of `width` x `height` pixels. */
export function frameSize(width: number, height: number, longEdge = PICTURE_LONG_EDGE): Size {
  if (!(width > 0 && height > 0)) throw new RangeError('Image has no size');
  return width >= height
    ? { width: longEdge, height: (longEdge * height) / width }
    : { width: (longEdge * width) / height, height: longEdge };
}

/**
 * Slots per layer: two in the lower row beside the board and HUD, three in an upper row above the
 * clocks. Later frames cascade into nearer layers instead of wrapping.
 */
export const PICTURE_SLOTS = 5;
/** Upper row: height above the eye, arc radius, and angle between its slots (one frame plus a gap). */
export const PICTURE_UPPER_ROW_Y = 1.05;
export const PICTURE_UPPER_ROW_RADIUS = 1.4;
export const PICTURE_SLOT_ANGLE = (32 * Math.PI) / 180;
/**
 * Each further layer sits this much nearer the eye and this much further from the fixed widgets
 * (lower for the lower row, higher for the upper row), so frames never coincide.
 */
export const PICTURE_LAYER_NEARER = 0.07;
export const PICTURE_LAYER_DROP = 0.035;

/**
 * Spawn offset for the frame in `slot`. `base` is the lower-left slot (x < 0). Every slot faces the
 * viewer and stays within about 45 degrees of straight ahead: lower left, its mirror at lower right
 * (both on an arc at the base's distance), then the upper row's centre, left and right. Slot
 * `PICTURE_SLOTS` and beyond repeat that layout nearer and further out.
 */
export function pictureSpawnOffset(
  base: readonly [number, number, number],
  slot: number,
): [number, number, number] {
  const index = Math.max(0, Math.floor(slot));
  const column = index % PICTURE_SLOTS;
  const layer = Math.floor(index / PICTURE_SLOTS);
  const nearer = PICTURE_LAYER_NEARER * layer;
  const away = PICTURE_LAYER_DROP * layer;
  if (column < 2) {
    const angle = (column === 0 ? 1 : -1) * Math.atan2(-base[0], -base[2]);
    const radius = Math.hypot(base[0], base[2]) - nearer;
    return [-Math.sin(angle) * radius, base[1] - away, -Math.cos(angle) * radius];
  }
  const angle = [0, 1, -1][column - 2] * PICTURE_SLOT_ANGLE;
  const radius = PICTURE_UPPER_ROW_RADIUS - nearer;
  return [-Math.sin(angle) * radius, PICTURE_UPPER_ROW_Y, -Math.cos(angle) * radius];
}

/** The slot a filled Add Picture placeholder keeps: its own spot, outside the slot layout. */
export const PICTURE_PLACEHOLDER_SLOT = -1;

/** The lowest slot not in `used`. */
export function freePictureSlot(used: Iterable<number>): number {
  const taken = new Set(used);
  let slot = 0;
  while (taken.has(slot)) slot += 1;
  return slot;
}

/**
 * The "Add Picture" placeholder spawns near and just left of the agent board, inside 45 degrees
 * of straight ahead, so it is fully in view without covering the clocks, board or HUD bar.
 */
export const PICTURE_PLACEHOLDER_OFFSET: readonly [number, number, number] = [-0.67, -0.17, -1.05];
export const PICTURE_PLACEHOLDER_SCALE = 0.6;

/** Reads pixel dimensions from PNG, GIF, WebP or JPEG header bytes; null for anything else. */
export function probeImageSize(bytes: Uint8Array): Size | null {
  const u16be = (at: number): number => (bytes[at] << 8) | bytes[at + 1];
  const u16le = (at: number): number => bytes[at] | (bytes[at + 1] << 8);
  const u24le = (at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  const u32be = (at: number): number =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const ascii = (at: number, text: string): boolean =>
    [...text].every((char, index) => bytes[at + index] === char.charCodeAt(0));
  const size = (width: number, height: number): Size | null =>
    width > 0 && height > 0 ? { width, height } : null;
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 'PNG') && ascii(12, 'IHDR'))
    return size(u32be(16), u32be(20));
  if (bytes.length >= 10 && ascii(0, 'GIF8')) return size(u16le(6), u16le(8));
  if (bytes.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return size(u24le(24) + 1, u24le(27) + 1);
    if (ascii(12, 'VP8L') && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(12, 'VP8 ')) return size(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return size(u16be(at + 7), u16be(at + 5));
      at += 2 + u16be(at + 2);
    }
  }
  return null;
}

export type PictureErrorCode =
  | 'cors'
  | 'http'
  | 'decode'
  | 'not-image'
  | 'too-large'
  | 'bad-url'
  | 'mixed-content'
  | 'timeout'
  | 'storage'
  | 'proxy-disabled'
  | 'proxy-auth'
  | 'proxy-rate-limited'
  | 'proxy-blocked'
  | 'proxy-too-large'
  | 'proxy-not-image'
  | 'proxy-timeout'
  | 'proxy-failed';

export class PictureLoadError extends Error {
  constructor(
    readonly code: PictureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PictureLoadError';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The user-facing notice for a failed picture load from `source` (a URL or a file name). */
export function pictureErrorNotice(code: PictureErrorCode, source: string, detail = ''): string {
  switch (code) {
    case 'cors':
      // A fetch TypeError covers both a CORS refusal and an unreachable host; the browser
      // does not say which, so the notice names both.
      return `Image blocked by CORS: ${hostOf(source)} (or the host is unreachable)`;
    case 'http':
      return `Image request failed${detail ? ` (${detail})` : ''}: ${hostOf(source)}`;
    case 'not-image':
      return `Not an image: ${source}`;
    case 'decode':
      return `Image could not be decoded: ${source}`;
    case 'too-large':
      return `Image is too large${detail ? ` (${detail})` : ''}: ${source}`;
    case 'bad-url':
      return `Not a valid http(s) image URL: ${source}`;
    case 'mixed-content':
      return 'Mixed content blocked: use an https URL';
    case 'timeout':
      return `Image request timed out after ${PICTURE_FETCH_TIMEOUT_MS / 1000} s: ${hostOf(source)}`;
    case 'proxy-disabled':
      return `Image blocked by CORS: ${hostOf(source)}. The picture proxy is off on the Mac (start the dictation server with --picture-proxy on)`;
    case 'proxy-auth':
      return 'The picture proxy rejected the pairing secret. Check it in Settings → Host clipboard';
    case 'proxy-rate-limited':
      return 'Too many picture proxy requests. Wait a minute and try again';
    case 'proxy-blocked':
      return `Picture proxy refused a private or local address: ${hostOf(source)}`;
    case 'proxy-too-large':
      return `Image is over the proxy's 10 MB limit: ${hostOf(source)}`;
    case 'proxy-not-image':
      return `Not a PNG, JPEG, GIF, WebP or HEIF image: ${hostOf(source)}`;
    case 'proxy-timeout':
      return `Picture proxy timed out fetching: ${hostOf(source)}`;
    case 'proxy-failed':
      return `Picture proxy could not fetch the image${detail ? ` (${detail})` : ''}: ${hostOf(source)}`;
    case 'storage':
      return `Picture shown but not saved on this device${detail ? `: ${detail}` : ''}`;
  }
}
