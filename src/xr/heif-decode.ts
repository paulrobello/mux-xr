import type { HeifWorkerReply, HeifWorkerRequest } from './heif-worker';
import { MAX_PICTURE_EDGE, MAX_PICTURE_SOURCE_EDGE, PictureLoadError } from './picture-sizing';

/**
 * HEIF's pixel cap is below the browser path's 64 MP: the wasm decode holds YCbCr planes, an RGBA
 * copy and the full-size ImageData at once. 50 MP still covers a 48 MP iPhone photo.
 */
export const MAX_HEIF_SOURCE_PIXELS = 50 * 1000 * 1000;

/** A 24 MP iPhone photo decodes in about 2.5 s on Quest 3; this bounds a stuck decode. */
const HEIF_DECODE_TIMEOUT_MS = 60_000;

/**
 * Decodes a HEIF blob in a fresh Worker and returns a bitmap no larger than MAX_PICTURE_EDGE, plus
 * the right eye for a stereo pair (then `image` is the left eye). The Worker is terminated
 * afterwards, which frees the wasm heap the full-size decode grew.
 */
export async function decodeHeifInWorker(
  blob: Blob,
): Promise<{ image: ImageBitmap; right?: ImageBitmap }> {
  const bytes = await blob.arrayBuffer();
  const worker = new Worker(new URL('./heif-worker.ts', import.meta.url), { type: 'module' });
  try {
    const reply = await new Promise<HeifWorkerReply>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PictureLoadError('decode', 'HEIF decode timed out')),
        HEIF_DECODE_TIMEOUT_MS,
      );
      worker.onmessage = (event: MessageEvent<HeifWorkerReply>) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onmessageerror = () => {
        clearTimeout(timer);
        reject(new PictureLoadError('decode', 'HEIF decoder reply could not be read'));
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        event.preventDefault();
        reject(new PictureLoadError('decode', event.message || 'HEIF decoder failed to load'));
      };
      const request: HeifWorkerRequest = {
        bytes,
        limits: { maxEdge: MAX_PICTURE_SOURCE_EDGE, maxPixels: MAX_HEIF_SOURCE_PIXELS },
        outputEdge: MAX_PICTURE_EDGE,
      };
      worker.postMessage(request, [bytes]);
    });
    if (!reply.ok) throw new PictureLoadError(reply.code, reply.detail);
    return reply.right ? { image: reply.bitmap, right: reply.right } : { image: reply.bitmap };
  } finally {
    worker.terminate();
  }
}
