/** Long edge of a frame's image plane at scale 1, in metres. */
export const PICTURE_LONG_EDGE = 0.6;
/** Aspect ratio of the empty placeholder frame. */
export const PLACEHOLDER_ASPECT = 4 / 3;

export interface Size {
  width: number;
  height: number;
}

/** The image plane size in metres for an image of `width` x `height` pixels. */
export function frameSize(width: number, height: number, longEdge = PICTURE_LONG_EDGE): Size {
  if (!(width > 0 && height > 0)) throw new RangeError('Image has no size');
  return width >= height
    ? { width: longEdge, height: (longEdge * height) / width }
    : { width: (longEdge * width) / height, height: longEdge };
}
