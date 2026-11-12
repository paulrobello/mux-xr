import {
  createDefaultPictureProxy,
  type PictureProxyFailure,
  type PictureProxyFetcher,
} from '../host-picture-fetch';
import {
  fitWithin,
  MAX_PICTURE_SOURCE_BYTES,
  MAX_PICTURE_SOURCE_EDGE,
  MAX_PICTURE_SOURCE_PIXELS,
  MAX_UNPROBED_PICTURE_BYTES,
  PICTURE_FETCH_TIMEOUT_MS,
  type PictureErrorCode,
  PictureLoadError,
  probeImageSize,
} from './picture-sizing';

/** A decoded picture drawn into a canvas no larger than MAX_PICTURE_EDGE on its long edge. */
export interface PictureImage {
  source: HTMLCanvasElement;
  width: number;
  height: number;
}

/** A picture ready to show and to store: the canvas plus its re-encoded downscaled blob. */
export interface PreparedPicture extends PictureImage {
  blob: Blob;
  name: string;
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close?: () => void;
}

export interface PictureLoaderDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  decode: (blob: Blob) => Promise<DecodedImage>;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  /** The page's protocol, for refusing http: URLs from an https: page. */
  pageProtocol?: string;
  /** Fetches through the dictation server when the direct CORS fetch is refused; absent means never. */
  proxy?: PictureProxyFetcher;
}

/** Refuses a source whose edge or area is over the decode limits. */
function checkSourceSize(width: number, height: number): void {
  if (
    Math.max(width, height) > MAX_PICTURE_SOURCE_EDGE ||
    width * height > MAX_PICTURE_SOURCE_PIXELS
  )
    throw new PictureLoadError('too-large', `${width}x${height} px`);
}

function browserDeps(): PictureLoaderDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    decode: (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' }),
    pageProtocol: typeof location === 'undefined' ? undefined : location.protocol,
    proxy: typeof window === 'undefined' ? undefined : createDefaultPictureProxy(),
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
}

const ENCODE_TYPE = 'image/webp';
const ENCODE_QUALITY = 0.9;

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new PictureLoadError('decode', 'Image could not be encoded')),
      ENCODE_TYPE,
      ENCODE_QUALITY,
    );
  });
}

/** Header bytes read for the pre-decode size probe; JPEG frame headers can follow large EXIF. */
const PROBE_BYTES = 256 * 1024;

async function headBytes(blob: Blob): Promise<Uint8Array> {
  const head = blob.slice(0, PROBE_BYTES);
  const buffer =
    typeof head.arrayBuffer === 'function'
      ? await head.arrayBuffer()
      : await new Response(head).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Decodes `blob`, downscales it into a canvas, and re-encodes the result for storage.
 * `reencode: false` reuses `blob` as the stored copy (a blob read back from storage).
 */
export async function preparePicture(
  blob: Blob,
  name: string,
  deps: PictureLoaderDeps = browserDeps(),
  options: { reencode?: boolean } = {},
): Promise<PreparedPicture> {
  if (blob.size > MAX_PICTURE_SOURCE_BYTES)
    throw new PictureLoadError('too-large', `${Math.round(blob.size / 1048576)} MB`);
  if (blob.type && !blob.type.startsWith('image/'))
    throw new PictureLoadError('not-image', blob.type);
  // Refuse an oversized image from its header so the browser never decodes it in full.
  const probed = probeImageSize(await headBytes(blob));
  if (probed) checkSourceSize(probed.width, probed.height);
  else if (blob.size > MAX_UNPROBED_PICTURE_BYTES)
    throw new PictureLoadError(
      'too-large',
      `size unreadable from the header and over ${MAX_UNPROBED_PICTURE_BYTES / 1048576} MB`,
    );
  let image: DecodedImage;
  try {
    image = await deps.decode(blob);
  } catch {
    throw new PictureLoadError('decode', name);
  }
  try {
    if (!(image.width > 0 && image.height > 0)) throw new PictureLoadError('decode', name);
    checkSourceSize(image.width, image.height);
    const size = fitWithin(image.width, image.height);
    const canvas = deps.createCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new PictureLoadError('decode', name);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image as CanvasImageSource, 0, 0, size.width, size.height);
    const stored = options.reencode === false ? blob : await encode(canvas);
    return { source: canvas, width: size.width, height: size.height, blob: stored, name };
  } finally {
    image.close?.();
  }
}

/** Loads a picked file. */
export function loadPictureFile(file: File, deps?: PictureLoaderDeps): Promise<PreparedPicture> {
  return preparePicture(file, file.name || 'image', deps);
}

/** Fetches `url` with CORS, falling back to the paired Mac's picture proxy, and loads it. */
export async function loadPictureUrl(
  url: string,
  deps: PictureLoaderDeps = browserDeps(),
): Promise<PreparedPicture> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PictureLoadError('bad-url', url);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new PictureLoadError('bad-url', url);
  const pageProtocol = 'pageProtocol' in deps ? deps.pageProtocol : browserDeps().pageProtocol;
  let blob: Blob;
  if (parsed.protocol === 'http:' && pageProtocol === 'https:') {
    // The browser blocks a direct http: fetch from an https: page, so only the paired Mac can load it.
    const mixed = new PictureLoadError('mixed-content', parsed.href);
    if (!deps.proxy) throw mixed;
    blob = await fetchViaProxy(parsed, deps.proxy, mixed);
  } else {
    try {
      blob = await fetchDirect(parsed, deps);
    } catch (error) {
      if (!(error instanceof PictureLoadError) || error.code !== 'cors' || !deps.proxy) throw error;
      blob = await fetchViaProxy(parsed, deps.proxy, error);
    }
  }
  const name = parsed.pathname.split('/').pop() || parsed.host;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Keep the raw path segment.
  }
  return preparePicture(blob, decoded, deps);
}

/** The direct browser fetch; a failure that may be CORS surfaces as a `cors` error. */
async function fetchDirect(parsed: URL, deps: PictureLoaderDeps): Promise<Blob> {
  // The signal also aborts the body read below, so a server that stalls mid-body times out too.
  const signal = AbortSignal.timeout(PICTURE_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(parsed.href, { mode: 'cors', credentials: 'omit', signal });
  } catch {
    throw signal.aborted
      ? new PictureLoadError('timeout', parsed.host)
      : new PictureLoadError('cors', parsed.host);
  }
  if (!response.ok) throw new PictureLoadError('http', `HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_PICTURE_SOURCE_BYTES)
    throw new PictureLoadError('too-large', `${Math.round(length / 1048576)} MB`);
  return readCapped(response, parsed.host, signal);
}

const PROXY_ERRORS: Partial<Record<PictureProxyFailure, PictureErrorCode>> = {
  disabled: 'proxy-disabled',
  auth: 'proxy-auth',
  'rate-limited': 'proxy-rate-limited',
  blocked: 'proxy-blocked',
  'too-large': 'proxy-too-large',
  'not-image': 'proxy-not-image',
  timeout: 'proxy-timeout',
  failed: 'proxy-failed',
  'bad-url': 'bad-url',
};

/** Not paired or unreachable keeps the original error (CORS or mixed content), since the proxy is not available. */
async function fetchViaProxy(
  parsed: URL,
  proxy: PictureProxyFetcher,
  direct: PictureLoadError,
): Promise<Blob> {
  const result = await proxy(parsed.href);
  if (result.ok) return result.blob;
  const code = PROXY_ERRORS[result.code];
  if (!code) throw direct;
  throw new PictureLoadError(code, parsed.host);
}

/** Reads a response body, aborting once it passes MAX_PICTURE_SOURCE_BYTES. */
async function readCapped(response: Response, host: string, signal: AbortSignal): Promise<Blob> {
  const failed = (): PictureLoadError =>
    signal.aborted ? new PictureLoadError('timeout', host) : new PictureLoadError('cors', host);
  const type = response.headers.get('content-type') ?? '';
  const tooLarge = (): PictureLoadError =>
    new PictureLoadError('too-large', `over ${Math.round(MAX_PICTURE_SOURCE_BYTES / 1048576)} MB`);
  if (!response.body) {
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      throw failed();
    }
    if (blob.size > MAX_PICTURE_SOURCE_BYTES) throw tooLarge();
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      throw failed();
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_PICTURE_SOURCE_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(step.value);
  }
  return new Blob(chunks as BlobPart[], { type });
}

/** Long edge of a Recent gallery thumbnail, so the grid never uploads full 2048 px textures. */
export const PICTURE_THUMBNAIL_EDGE = 256;

/** Draws `source` into a canvas no larger than PICTURE_THUMBNAIL_EDGE and encodes it as WebP. */
export function createPictureThumbnail(
  source: HTMLCanvasElement,
  deps: Pick<PictureLoaderDeps, 'createCanvas'> = browserDeps(),
): Promise<Blob> {
  const size = fitWithin(source.width, source.height, PICTURE_THUMBNAIL_EDGE);
  const canvas = deps.createCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new PictureLoadError('decode', 'thumbnail'));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  return encode(canvas);
}

/** Decodes a blob read back from storage, without re-encoding it. */
export function restorePicture(
  blob: Blob,
  name: string,
  deps?: PictureLoaderDeps,
): Promise<PreparedPicture> {
  return preparePicture(blob, name, deps, { reencode: false });
}
