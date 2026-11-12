/** A depth map: one byte per pixel, 255 nearest, row-major, PNG-encoded. */
export interface DepthMap {
  width: number;
  height: number;
  png: Buffer;
}

export interface DepthEstimator {
  /**
   * Estimates relative depth for an already-validated image. Calls run one at a time; a call whose
   * signal aborted before its turn rejects without running.
   */
  estimate(image: Buffer, signal?: AbortSignal): Promise<DepthMap>;
}

/** The model's short side and patch size (Depth Anything V2 preprocessor_config.json). */
const MODEL_SHORT_SIDE = 518;
const PATCH = 14;
/** A wide panorama is scaled by its long side instead, so inference cost stays bounded. */
const MODEL_LONG_SIDE = 1036;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
/** The client sends its stored picture, at most 2048 px on the long edge. */
export const DEPTH_MAX_INPUT_EDGE = 2048;

/** The model input size for a `width` x `height` image: short side 518, multiples of 14. */
export function depthInputSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    MODEL_SHORT_SIDE / Math.min(width, height),
    MODEL_LONG_SIDE / Math.max(width, height),
  );
  const snap = (value: number): number =>
    Math.max(PATCH, Math.round((value * scale) / PATCH) * PATCH);
  return { width: snap(width), height: snap(height) };
}

/** Scales relative inverse depth to 0..255 so near is bright, whatever the scene's range. */
export function normalizeDepth(values: ArrayLike<number>): Uint8Array {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const out = new Uint8Array(values.length);
  const span = high - low;
  if (!(span > 0)) return out;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    out[index] = Number.isFinite(value) ? Math.round((255 * (value - low)) / span) : 0;
  }
  return out;
}

/**
 * Depth Anything V2 Small through onnxruntime-node. The runtime and the model load on first use,
 * so a server started without depth enabled never touches either.
 */
export function createOnnxDepthEstimator(options: {
  modelPath: string;
  /** Inference threads; kept low so depth never starves dictation on the same Mac. */
  threads?: number;
}): DepthEstimator {
  type Runtime = {
    ort: typeof import('onnxruntime-node');
    sharp: typeof import('sharp').default;
    session: import('onnxruntime-node').InferenceSession;
  };
  let runtime: Promise<Runtime> | null = null;
  const load = (): Promise<Runtime> => {
    runtime ??= (async () => {
      const ort = await import('onnxruntime-node');
      const sharp = (await import('sharp')).default;
      const session = await ort.InferenceSession.create(options.modelPath, {
        intraOpNumThreads: options.threads ?? 3,
        interOpNumThreads: 1,
      });
      return { ort, sharp, session };
    })().catch((error: unknown) => {
      runtime = null;
      throw error;
    });
    return runtime;
  };
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (image: Buffer): Promise<DepthMap> => {
    const { ort, sharp, session } = await load();
    const limitInputPixels = DEPTH_MAX_INPUT_EDGE * DEPTH_MAX_INPUT_EDGE;
    const meta = await sharp(image, { limitInputPixels, failOn: 'error' }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!(width > 0 && height > 0) || Math.max(width, height) > DEPTH_MAX_INPUT_EDGE)
      throw new Error('image size out of range');
    const size = depthInputSize(width, height);
    const { data } = await sharp(image, { limitInputPixels, failOn: 'error' })
      .resize(size.width, size.height, { fit: 'fill', kernel: 'cubic' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const plane = size.width * size.height;
    const tensor = new Float32Array(3 * plane);
    for (let pixel = 0; pixel < plane; pixel += 1)
      for (let channel = 0; channel < 3; channel += 1)
        tensor[channel * plane + pixel] =
          (data[pixel * 3 + channel] / 255 - MEAN[channel]) / STD[channel];
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size.height, size.width]),
    });
    const output = outputs[session.outputNames[0]];
    const dims = output.dims;
    const outHeight = Number(dims[dims.length - 2]);
    const outWidth = Number(dims[dims.length - 1]);
    const depth = normalizeDepth(output.data as Float32Array);
    const png = await sharp(Buffer.from(depth), {
      raw: { width: outWidth, height: outHeight, channels: 1 },
    })
      .png()
      .toBuffer();
    return { width: outWidth, height: outHeight, png };
  };

  return {
    estimate: (image, signal) => {
      const turn = (): Promise<DepthMap> =>
        signal?.aborted ? Promise.reject(new Error('aborted')) : run(image);
      const result = queue.then(turn, turn);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
