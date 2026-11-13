import * as THREE from 'three';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  validateTerminalFiltering,
} from '../terminal/filtering';

export interface TerminalTextureSurface {
  readonly canvas: HTMLCanvasElement;
  /** Flags are indexed by logical terminal row, not canvas pixel row. */
  readonly dirtyRows?: Uint8Array;
}

export interface TerminalTexture {
  readonly texture: THREE.Texture;
  /** A resized texture is still filling in strips; call advance() each frame. */
  readonly swapPending: boolean;
  setFiltering(settings: TerminalFiltering): void;
  /** Upload what the surface's latest paint changed. */
  update(): void;
  /** Continue filling a resized texture without a new paint. */
  advance(): void;
  dispose(): void;
}

// A resized canvas fills its replacement texture this many logical rows per update. Uploading a
// full 3289x1029 terminal in one call stalled a Quest 3 frame by ~100 ms.
const SWAP_ROWS_PER_UPDATE = 8;

interface PendingSwap {
  texture: THREE.DataTexture;
  source: THREE.DataTexture;
  data: Uint8Array;
  width: number;
  height: number;
  rows: Uint8Array;
  remaining: number;
  allocated: boolean;
}

export interface TerminalTextureRenderer {
  copyTextureToTexture: THREE.WebGLRenderer['copyTextureToTexture'];
  capabilities?: Pick<THREE.WebGLRenderer['capabilities'], 'getMaxAnisotropy'>;
}

function configureTexture(
  texture: THREE.Texture,
  settings: TerminalFiltering,
  renderer?: TerminalTextureRenderer,
): void {
  const effective = resolveTextureFiltering(settings, renderer);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = effective.minFilter;
  texture.magFilter = effective.magFilter;
  texture.generateMipmaps = effective.generateMipmaps;
  texture.anisotropy = effective.anisotropy;
}

interface EffectiveTextureFiltering {
  minFilter: THREE.MinificationTextureFilter;
  magFilter: THREE.MagnificationTextureFilter;
  generateMipmaps: boolean;
  anisotropy: number;
}

function resolveTextureFiltering(
  settings: TerminalFiltering,
  renderer?: TerminalTextureRenderer,
): EffectiveTextureFiltering {
  const filtering = validateTerminalFiltering(settings);
  const nearest = filtering.mode === 'nearest';
  const mipmapMode = filtering.mode === 'mipmap-nearest' || filtering.mode === 'mipmap-linear';
  const minFilter =
    filtering.mode === 'nearest'
      ? THREE.NearestFilter
      : filtering.mode === 'linear'
        ? THREE.LinearFilter
        : filtering.mode === 'mipmap-nearest'
          ? THREE.LinearMipmapNearestFilter
          : THREE.LinearMipmapLinearFilter;
  const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.();
  return {
    minFilter,
    magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
    generateMipmaps: mipmapMode,
    anisotropy: Number.isFinite(maxAnisotropy)
      ? Math.max(1, Math.min(filtering.anisotropy, maxAnisotropy as number))
      : 1,
  };
}

function copyTextureSettings(from: THREE.Texture, to: THREE.Texture): void {
  to.wrapS = from.wrapS;
  to.wrapT = from.wrapT;
  to.magFilter = from.magFilter;
  to.minFilter = from.minFilter;
  to.anisotropy = from.anisotropy;
  to.colorSpace = from.colorSpace;
  to.premultiplyAlpha = from.premultiplyAlpha;
  to.unpackAlignment = from.unpackAlignment;
  to.repeat.copy(from.repeat);
  to.offset.copy(from.offset);
  to.center.copy(from.center);
  to.rotation = from.rotation;
  to.matrixAutoUpdate = from.matrixAutoUpdate;
  to.matrix.copy(from.matrix);
  to.generateMipmaps = from.generateMipmaps;
}

function copyFlipped(
  source: Uint8ClampedArray | Uint8Array,
  target: Uint8Array,
  width: number,
  height: number,
): void {
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * rowBytes;
    const destinationStart = (height - 1 - row) * rowBytes;
    target.set(source.subarray(sourceStart, sourceStart + rowBytes), destinationStart);
  }
}

export function createTerminalTexture(
  surface: TerminalTextureSurface,
  renderer?: TerminalTextureRenderer,
): TerminalTexture {
  let canvasWidth = surface.canvas.width;
  let canvasHeight = surface.canvas.height;
  let context = surface.canvas.getContext('2d');
  let data: Uint8Array | null = null;
  let texture: THREE.Texture;
  let uploadSource: THREE.DataTexture | null = null;
  const copyRegion = new THREE.Box2();
  const copyPosition = new THREE.Vector2();
  const canCopyRegion = typeof renderer?.copyTextureToTexture === 'function';

  if (context && typeof context.getImageData === 'function') {
    const image = context.getImageData(0, 0, canvasWidth, canvasHeight);
    data = new Uint8Array(image.data.length);
    copyFlipped(image.data, data, canvasWidth, canvasHeight);
    const dataTexture = new THREE.DataTexture(data, canvasWidth, canvasHeight, THREE.RGBAFormat);
    dataTexture.flipY = false;
    texture = dataTexture;
  } else {
    texture = new THREE.CanvasTexture(surface.canvas);
  }
  let currentFiltering = validateTerminalFiltering(DEFAULT_TERMINAL_FILTERING);
  let effectiveFiltering = resolveTextureFiltering(currentFiltering, renderer);
  configureTexture(texture, currentFiltering, renderer);
  texture.needsUpdate = true;

  let disposed = false;
  const rowsForCanvas = (): number => surface.dirtyRows?.length || canvasHeight;
  const markRows = (first: number, last: number): void => {
    if (!context || !data) return;
    const rowCount = Math.max(1, rowsForCanvas());
    const pixelRowStart = Math.floor((first * canvasHeight) / rowCount);
    const pixelRowEnd = Math.min(canvasHeight, Math.ceil(((last + 1) * canvasHeight) / rowCount));
    if (pixelRowEnd <= pixelRowStart) return;
    const image = context.getImageData(0, pixelRowStart, canvasWidth, pixelRowEnd - pixelRowStart);
    const rowBytes = canvasWidth * 4;
    for (let sourceRow = 0; sourceRow < pixelRowEnd - pixelRowStart; sourceRow += 1) {
      const destinationRow = canvasHeight - 1 - (pixelRowStart + sourceRow);
      const destination = destinationRow * rowBytes;
      const source = sourceRow * rowBytes;
      data.set(image.data.subarray(source, source + rowBytes), destination);
      if (!canCopyRegion) texture.addUpdateRange(destination, rowBytes);
    }
    if (canCopyRegion) {
      // Keep this CPU source uninitialized so Three copies its data instead of blitting a GPU texture.
      uploadSource ??= new THREE.DataTexture(data, canvasWidth, canvasHeight, THREE.RGBAFormat);
      copyRegion.min.set(0, canvasHeight - pixelRowEnd);
      copyRegion.max.set(canvasWidth, canvasHeight - pixelRowStart);
      copyPosition.copy(copyRegion.min);
      renderer?.copyTextureToTexture(uploadSource, texture, copyRegion, copyPosition);
    }
  };
  const makeTexture = (): void => {
    const previous = texture;
    uploadSource?.dispose();
    uploadSource = null;
    canvasWidth = surface.canvas.width;
    canvasHeight = surface.canvas.height;
    context = surface.canvas.getContext('2d');
    if (context && typeof context.getImageData === 'function') {
      const image = context.getImageData(0, 0, canvasWidth, canvasHeight);
      data = new Uint8Array(image.data.length);
      copyFlipped(image.data, data, canvasWidth, canvasHeight);
      const next = new THREE.DataTexture(data, canvasWidth, canvasHeight, THREE.RGBAFormat);
      next.flipY = false;
      texture = next;
    } else {
      data = null;
      texture = new THREE.CanvasTexture(surface.canvas);
    }
    copyTextureSettings(previous, texture);
    texture.needsUpdate = true;
    previous.dispose();
  };

  let pending: PendingSwap | null = null;
  const copyRows = (
    target: { texture: THREE.Texture; source: THREE.DataTexture; data: Uint8Array },
    width: number,
    height: number,
    rowCount: number,
    first: number,
    last: number,
  ): void => {
    if (!context) return;
    const pixelRowStart = Math.floor((first * height) / rowCount);
    const pixelRowEnd = Math.min(height, Math.ceil(((last + 1) * height) / rowCount));
    if (pixelRowEnd <= pixelRowStart) return;
    const image = context.getImageData(0, pixelRowStart, width, pixelRowEnd - pixelRowStart);
    const rowBytes = width * 4;
    for (let sourceRow = 0; sourceRow < pixelRowEnd - pixelRowStart; sourceRow += 1) {
      const destination = (height - 1 - (pixelRowStart + sourceRow)) * rowBytes;
      const source = sourceRow * rowBytes;
      target.data.set(image.data.subarray(source, source + rowBytes), destination);
    }
    copyRegion.min.set(0, height - pixelRowEnd);
    copyRegion.max.set(width, height - pixelRowStart);
    copyPosition.copy(copyRegion.min);
    renderer?.copyTextureToTexture(target.source, target.texture, copyRegion, copyPosition);
  };
  const cancelSwap = (): void => {
    if (!pending) return;
    pending.source.dispose();
    pending.texture.dispose();
    pending = null;
  };
  const startSwap = (width: number, height: number): void => {
    cancelSwap();
    const rowCount = Math.max(1, surface.dirtyRows?.length || height);
    const data = new Uint8Array(width * height * 4);
    const next = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    next.flipY = false;
    copyTextureSettings(texture, next);
    // Allocate GPU storage without uploading data; strips fill it.
    next.source.dataReady = false;
    next.needsUpdate = true;
    pending = {
      texture: next,
      source: new THREE.DataTexture(data, width, height, THREE.RGBAFormat),
      data,
      width,
      height,
      rows: new Uint8Array(rowCount).fill(1),
      remaining: rowCount,
      allocated: false,
    };
  };
  const advanceSwap = (newPaint: boolean): void => {
    const swap = pending;
    if (!swap) return;
    const rowCount = swap.rows.length;
    const dirty = surface.dirtyRows;
    if (newPaint && dirty && dirty.length === rowCount)
      for (let row = 0; row < rowCount; row += 1)
        if (dirty[row] && !swap.rows[row]) {
          swap.rows[row] = 1;
          swap.remaining += 1;
        }
    let budget = SWAP_ROWS_PER_UPDATE;
    let first = -1;
    const flush = (last: number): void => {
      if (first < 0) return;
      // The first copy allocates storage, whose mip level count follows generateMipmaps, and
      // the last builds the mip chain; strips in between skip regenerating it.
      swap.texture.generateMipmaps =
        (!swap.allocated || swap.remaining === 0) && effectiveFiltering.generateMipmaps;
      copyRows(swap, swap.width, swap.height, rowCount, first, last);
      swap.allocated = true;
      first = -1;
    };
    for (let row = 0; row < rowCount && budget > 0; row += 1) {
      if (!swap.rows[row]) {
        flush(row - 1);
        continue;
      }
      swap.rows[row] = 0;
      swap.remaining -= 1;
      budget -= 1;
      if (first < 0) first = row;
      if (budget === 0 || row === rowCount - 1) flush(row);
    }
    flush(rowCount - 1);
    if (swap.remaining > 0) return;
    const previous = texture;
    uploadSource?.dispose();
    uploadSource = swap.source;
    texture = swap.texture;
    texture.source.dataReady = true;
    data = swap.data;
    canvasWidth = swap.width;
    canvasHeight = swap.height;
    pending = null;
    previous.dispose();
  };

  return {
    get texture(): THREE.Texture {
      return texture;
    },
    get swapPending(): boolean {
      return pending !== null;
    },
    setFiltering(settings: TerminalFiltering): void {
      const nextFiltering = validateTerminalFiltering(settings);
      const nextEffectiveFiltering = resolveTextureFiltering(nextFiltering, renderer);
      if (
        nextEffectiveFiltering.minFilter === effectiveFiltering.minFilter &&
        nextEffectiveFiltering.magFilter === effectiveFiltering.magFilter &&
        nextEffectiveFiltering.generateMipmaps === effectiveFiltering.generateMipmaps &&
        nextEffectiveFiltering.anisotropy === effectiveFiltering.anisotropy
      )
        return;
      currentFiltering = nextFiltering;
      effectiveFiltering = nextEffectiveFiltering;
      configureTexture(texture, currentFiltering, renderer);
      texture.needsUpdate = true;
      if (pending) configureTexture(pending.texture, currentFiltering, renderer);
    },
    update(): void {
      if (disposed) return;
      const width = surface.canvas.width;
      const height = surface.canvas.height;
      if (width !== canvasWidth || height !== canvasHeight) {
        if (!canCopyRegion || !data) {
          makeTexture();
          return;
        }
        if (pending?.width !== width || pending?.height !== height) startSwap(width, height);
        advanceSwap(true);
        return;
      }
      if (pending) {
        // The canvas returned to the displayed size before the swap finished.
        cancelSwap();
        markRows(0, rowsForCanvas() - 1);
        if (texture.updateRanges.length > 0) texture.needsUpdate = true;
        return;
      }
      const dirtyRows = surface.dirtyRows;
      if (!dirtyRows) {
        if (data) markRows(0, canvasHeight - 1);
        else texture.needsUpdate = true;
        if (data && texture.updateRanges.length > 0) texture.needsUpdate = true;
        return;
      }
      let first = -1;
      for (let row = 0; row <= dirtyRows.length; row += 1) {
        const dirty = row < dirtyRows.length && dirtyRows[row] !== 0;
        if (dirty && first < 0) first = row;
        if (!dirty && first >= 0) {
          if (data) markRows(first, row - 1);
          else texture.needsUpdate = true;
          first = -1;
        }
      }
      if (data && texture.updateRanges.length > 0) texture.needsUpdate = true;
    },
    advance(): void {
      if (disposed || !pending) return;
      if (surface.canvas.width !== pending.width || surface.canvas.height !== pending.height)
        return;
      advanceSwap(false);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelSwap();
      uploadSource?.dispose();
      texture.dispose();
    },
  };
}
