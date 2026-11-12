import libheif from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { decodeHeifPixels, HeifDecodeError, type HeifLibrary, type HeifLimits } from './heif-core';
import { fitWithin } from './picture-sizing';

export interface HeifWorkerRequest {
  bytes: ArrayBuffer;
  limits: HeifLimits;
  /** Long edge of the returned bitmap, so only a texture-sized image crosses back. */
  outputEdge: number;
}

export type HeifWorkerReply =
  | { ok: true; bitmap: ImageBitmap }
  | { ok: false; code: 'decode' | 'too-large'; detail: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HeifWorkerRequest>) => void) | null;
  onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
  postMessage(message: HeifWorkerReply, transfer?: Transferable[]): void;
};

// libheif-js decodes inside a setTimeout callback, so a wasm abort or an oversized copy rejects
// there and never reaches the awaited display(); report it now instead of waiting for the timeout.
scope.onunhandledrejection = (event) => {
  scope.postMessage({ ok: false, code: 'decode', detail: String(event.reason) });
};

scope.onmessage = async (event) => {
  const { bytes, limits, outputEdge } = event.data;
  try {
    // An ArrayBuffer avoids instantiateStreaming, which needs an application/wasm response type.
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const lib = libheif({ wasmBinary }) as HeifLibrary;
    const pixels = await decodeHeifPixels(lib, new Uint8Array(bytes), limits);
    const size = fitWithin(pixels.width, pixels.height, outputEdge);
    const image = new ImageData(pixels.data, pixels.width, pixels.height);
    const bitmap = await createImageBitmap(image, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    });
    scope.postMessage({ ok: true, bitmap }, [bitmap]);
  } catch (error) {
    scope.postMessage(
      error instanceof HeifDecodeError
        ? { ok: false, code: error.code, detail: error.detail }
        : { ok: false, code: 'decode', detail: error instanceof Error ? error.message : 'failed' },
    );
  }
};
