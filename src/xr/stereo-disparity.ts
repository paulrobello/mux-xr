/** Horizontal disparity of a stereo pair, as fractions of the image width. */
export interface StereoDisparity {
  /** The nearest content's disparity (90th percentile of matched blocks). */
  near: number;
  /** The most common content's disparity (median of matched blocks). */
  typical: number;
}

/** Long edge the eyes are shrunk to before matching; enough to find disparity, cheap to scan. */
const MEASURE_EDGE = 192;
const BLOCK = 12;
/** Disparity searched either way, as a fraction of the width; phone stereo stays well inside it. */
const MAX_SHIFT = 0.1;
/** A block flatter than this (luma variance) has no texture to match. */
const MIN_VARIANCE = 40;

const luma = (rgba: Uint8ClampedArray, pixels: number): Float32Array => {
  const out = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++)
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return out;
};

const percentile = (sorted: number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];

/**
 * Block-matches the left eye against the right along rows. Positive disparity means a feature sits
 * further right in the left eye than in the right (crossed: in front of a zero-disparity plane).
 */
export function estimateDisparity(
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
  width: number,
  height: number,
): StereoDisparity {
  const l = luma(left, width * height);
  const r = luma(right, width * height);
  const maxShift = Math.max(1, Math.round(width * MAX_SHIFT));
  const shifts: number[] = [];
  for (let y = 0; y + BLOCK <= height; y += BLOCK)
    for (let x = maxShift; x + BLOCK + maxShift <= width; x += BLOCK) {
      let sum = 0;
      let squares = 0;
      for (let by = 0; by < BLOCK; by++)
        for (let bx = 0; bx < BLOCK; bx++) {
          const value = r[(y + by) * width + x + bx];
          sum += value;
          squares += value * value;
        }
      const count = BLOCK * BLOCK;
      if (squares / count - (sum / count) ** 2 < MIN_VARIANCE) continue;
      let best = Number.POSITIVE_INFINITY;
      let bestShift = 0;
      for (let shift = -maxShift; shift <= maxShift; shift++) {
        let cost = 0;
        for (let by = 0; by < BLOCK && cost < best; by++) {
          const row = (y + by) * width + x;
          for (let bx = 0; bx < BLOCK; bx++) cost += Math.abs(l[row + bx + shift] - r[row + bx]);
        }
        if (cost < best) {
          best = cost;
          bestShift = shift;
        }
      }
      shifts.push(bestShift);
    }
  if (!shifts.length) return { near: 0, typical: 0 };
  shifts.sort((a, b) => a - b);
  return { near: percentile(shifts, 0.9) / width, typical: percentile(shifts, 0.5) / width };
}

/** Measures a stereo pair drawn on canvases; null when the canvases cannot be read. */
export function measureStereoCanvases(
  left: HTMLCanvasElement,
  right: HTMLCanvasElement,
  createCanvas: (width: number, height: number) => HTMLCanvasElement = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
): StereoDisparity | null {
  if (!(left.width > 0 && left.height > 0)) return null;
  const scale = Math.min(1, MEASURE_EDGE / Math.max(left.width, left.height));
  const width = Math.max(1, Math.round(left.width * scale));
  const height = Math.max(1, Math.round(left.height * scale));
  const read = (source: HTMLCanvasElement): Uint8ClampedArray | null => {
    try {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(source, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    } catch {
      return null;
    }
  };
  const l = read(left);
  const r = read(right);
  return l && r ? estimateDisparity(l, r, width, height) : null;
}
