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
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImageHandle[] };
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

/**
 * Decodes the primary image of a HEIF file to RGBA, with rotation and mirroring applied. The size
 * is read from the container first, so an oversized image is refused before any HEVC decoding.
 */
export async function decodeHeifPixels(
  lib: HeifLibrary,
  bytes: Uint8Array,
  limits: HeifLimits,
): Promise<HeifPixels> {
  const images = new lib.HeifDecoder().decode(bytes);
  try {
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) throw new HeifDecodeError('decode', 'no image in the file');
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0)) throw new HeifDecodeError('decode', 'image has no size');
    if (Math.max(width, height) > limits.maxEdge || width * height > limits.maxPixels)
      throw new HeifDecodeError('too-large', `${width}x${height} px`);
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const shown = await new Promise<unknown>((resolve) => image.display(target, resolve));
    if (!shown) throw new HeifDecodeError('decode', 'HEVC decoding failed');
    return target;
  } finally {
    for (const image of images) image.free();
  }
}
