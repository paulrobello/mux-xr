/** The slice of the libheif-js high-level API the decoder uses. */
export interface HeifImageHandle {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: unknown) => void,
  ): void;
  free(): void;
}

export interface HeifLibrary {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImageHandle[]; decoder?: unknown };
  /** The item ids of `decode`'s images, in the same order; used to find a stereo pair's eyes. */
  heif_js_context_get_list_of_top_level_image_IDs?: (context: unknown) => unknown;
}

export interface HeifLimits {
  maxEdge: number;
  maxPixels: number;
}

export interface HeifPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export class HeifDecodeError extends Error {
  constructor(
    readonly code: 'decode' | 'too-large',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

/** A decoded HEIF picture; a stereo pair (an iPhone spatial photo) also carries the right eye. */
export interface HeifDecoded {
  image: HeifPixels;
  right?: HeifPixels;
}

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** The [start, end) payload ranges of the boxes in bytes[start, end), each with its type. */
function* childBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
): Generator<{ type: string; body: number; end: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      const high = view.getUint32(at + 8);
      if (high !== 0) return;
      size = view.getUint32(at + 12);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) return;
    yield { type: fourcc(bytes, at + 4), body: at + header, end: at + size };
    at += size;
  }
}

/**
 * The left and right item ids of a HEIF stereo pair, from the 'ster' entity group in the file's
 * meta box (the first entity is the left view); null when the file has no stereo pair.
 */
export function readStereoPair(bytes: Uint8Array): { left: number; right: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const meta of childBoxes(bytes, 0, bytes.length)) {
    if (meta.type !== 'meta') continue;
    // meta is a FullBox: version and flags precede its children.
    for (const group of childBoxes(bytes, meta.body + 4, meta.end)) {
      if (group.type !== 'grpl') continue;
      for (const entry of childBoxes(bytes, group.body, group.end)) {
        // FullBox header, group_id, num_entities_in_group, then the entity ids.
        if (entry.type !== 'ster' || entry.body + 20 > entry.end) continue;
        if (view.getUint32(entry.body + 8) !== 2) continue;
        return { left: view.getUint32(entry.body + 12), right: view.getUint32(entry.body + 16) };
      }
    }
    return null;
  }
  return null;
}

async function decodeHandle(image: HeifImageHandle, limits: HeifLimits): Promise<HeifPixels> {
  const width = image.get_width();
  const height = image.get_height();
  if (!(width > 0 && height > 0)) throw new HeifDecodeError('decode', 'image has no size');
  if (Math.max(width, height) > limits.maxEdge || width * height > limits.maxPixels)
    throw new HeifDecodeError('too-large', `${width}x${height} px`);
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const shown = await new Promise<unknown>((resolve) => image.display(target, resolve));
  if (!shown) throw new HeifDecodeError('decode', 'HEVC decoding failed');
  return target;
}

/**
 * Decodes a HEIF file to RGBA, with rotation and mirroring applied: both eyes of a stereo pair, else
 * the primary image. Sizes are read from the container first, so an oversized image is refused
 * before any HEVC decoding.
 */
export async function decodeHeifPixels(
  lib: HeifLibrary,
  bytes: Uint8Array,
  limits: HeifLimits,
): Promise<HeifDecoded> {
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const eyes = stereoHandles(lib, decoder.decoder, images, readStereoPair(bytes), limits);
    if (eyes) {
      const image = await decodeHandle(eyes.left, limits);
      return { image, right: await decodeHandle(eyes.right, limits) };
    }
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) throw new HeifDecodeError('decode', 'no image in the file');
    return { image: await decodeHandle(image, limits) };
  } finally {
    for (const image of images) image.free();
  }
}

/** The stereo pair's image handles, when both eyes are top-level images of the same size. */
function stereoHandles(
  lib: HeifLibrary,
  context: unknown,
  images: HeifImageHandle[],
  pair: { left: number; right: number } | null,
  limits: HeifLimits,
): { left: HeifImageHandle; right: HeifImageHandle } | null {
  if (!pair || !context || !lib.heif_js_context_get_list_of_top_level_image_IDs) return null;
  const ids = lib.heif_js_context_get_list_of_top_level_image_IDs(context);
  // The decoder skips a handle it cannot open, so ids only line up with images when none failed.
  if (!Array.isArray(ids) || ids.length !== images.length) return null;
  const left = images[ids.indexOf(pair.left)];
  const right = images[ids.indexOf(pair.right)];
  if (!left || !right || left === right) return null;
  if (left.get_width() !== right.get_width() || left.get_height() !== right.get_height())
    return null;
  // Both eyes' full-size pixels are alive at once, so the pair shares one image's pixel budget;
  // a larger pair shows its primary image instead. iPhone eyes are about 5 MP each.
  if (2 * left.get_width() * left.get_height() > limits.maxPixels) return null;
  return { left, right };
}
