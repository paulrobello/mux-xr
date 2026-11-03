import * as THREE from 'three';

/** The largest supported horizontal terminal bend. */
export const MAX_TERMINAL_CURVATURE_RADIANS = (100 * Math.PI) / 180;

export interface TerminalWarpSpan {
  width: number;
  height: number;
  /** Horizontal bend in radians. Zero is a flat screen. */
  radians: number;
}

export interface TerminalWarpOptions extends TerminalWarpSpan {
  /** Number of horizontal subdivisions used by generated surfaces. */
  segments?: number;
}

export interface TerminalWarpBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export interface TerminalSelectionOptions extends TerminalWarpOptions {
  /** Border thickness in local screen units. Defaults to 0.025. */
  border?: number;
  /** Original screen width when the outline includes outer padding. */
  surfaceWidth?: number;
}

function validateSpan(span: TerminalWarpSpan): void {
  if (!Number.isFinite(span.width) || span.width <= 0) {
    throw new RangeError('Terminal warp width must be a finite positive number');
  }
  if (!Number.isFinite(span.height) || span.height <= 0) {
    throw new RangeError('Terminal warp height must be a finite positive number');
  }
}

export function clampTerminalCurvatureRadians(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return THREE.MathUtils.clamp(radians, 0, MAX_TERMINAL_CURVATURE_RADIANS);
}

/** Map normalized horizontal coordinates onto a concave cylindrical screen. */
export function terminalWarpPoint(
  x: number,
  span: TerminalWarpSpan,
): { x: number; z: number; normalX: number; normalZ: number } {
  validateSpan(span);
  const radians = clampTerminalCurvatureRadians(span.radians);
  if (radians === 0) return { x, z: 0, normalX: 0, normalZ: 1 };
  const radius = span.width / radians;
  const theta = (x / span.width) * radians;
  return {
    x: radius * Math.sin(theta),
    z: radius * (1 - Math.cos(theta)),
    normalX: -Math.sin(theta),
    normalZ: Math.cos(theta),
  };
}

/** Create a screen whose logical UV rectangle remains unchanged by curvature. */
export function createCurvedTerminalGeometry(options: TerminalWarpOptions): THREE.BufferGeometry {
  validateSpan(options);
  const segmentCount = Math.max(1, Math.floor(options.segments ?? 32));
  const radians = clampTerminalCurvatureRadians(options.radians);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= 1; row += 1) {
    const y = (row - 0.5) * options.height;
    for (let column = 0; column <= segmentCount; column += 1) {
      const u = column / segmentCount;
      const point = terminalWarpPoint((u - 0.5) * options.width, {
        width: options.width,
        height: options.height,
        radians,
      });
      positions.push(point.x, y, point.z);
      normals.push(point.normalX, 0, point.normalZ);
      // Keep x left-to-right and y bottom-to-top for terminal mouse picking.
      uvs.push(u, row);
    }
  }

  for (let column = 0; column < segmentCount; column += 1) {
    const a = column;
    const b = column + 1;
    const c = segmentCount + 1 + column + 1;
    const d = segmentCount + 1 + column;
    indices.push(a, b, d, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Create a curved outline mesh suitable for a Basic/line-like selection material. */
export function createCurvedTerminalSelection(
  options: TerminalSelectionOptions,
): THREE.BufferGeometry {
  validateSpan(options);
  const segmentCount = Math.max(4, Math.floor(options.segments ?? 32));
  const border = Math.min(options.border ?? 0.025, options.width / 2, options.height / 2);
  const surfaceWidth = options.surfaceWidth ?? options.width;
  const surface = { width: surfaceWidth, height: options.height, radians: options.radians };
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, u: number, v: number): number => {
    const point = terminalWarpPoint(x, surface);
    positions.push(point.x, y, point.z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const addQuad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, d, b, c, d);
  };

  const samples = [
    ...new Set([
      ...Array.from(
        { length: segmentCount + 1 },
        (_, column) => (column / segmentCount - 0.5) * surfaceWidth,
      ),
      -options.width / 2,
      options.width / 2,
      -options.width / 2 + border,
      options.width / 2 - border,
    ]),
  ].sort((a, b) => a - b);
  for (let column = 0; column < samples.length - 1; column += 1) {
    const x0 = samples[column];
    const x1 = samples[column + 1];
    const u0 = x0 / options.width + 0.5;
    const u1 = x1 / options.width + 0.5;
    addQuad(
      addVertex(x0, options.height / 2 - border, u0, 1),
      addVertex(x1, options.height / 2 - border, u1, 1),
      addVertex(x1, options.height / 2, u1, 1),
      addVertex(x0, options.height / 2, u0, 1),
    );
    addQuad(
      addVertex(x0, -options.height / 2, u0, 0),
      addVertex(x1, -options.height / 2, u1, 0),
      addVertex(x1, -options.height / 2 + border, u1, 0),
      addVertex(x0, -options.height / 2 + border, u0, 0),
    );
  }
  const left = -options.width / 2;
  const right = options.width / 2;
  addQuad(
    addVertex(left, -options.height / 2 + border, 0, 0),
    addVertex(left + border, -options.height / 2 + border, 0, 0),
    addVertex(left + border, options.height / 2 - border, 0, 1),
    addVertex(left, options.height / 2 - border, 0, 1),
  );
  addQuad(
    addVertex(right - border, -options.height / 2 + border, 1, 0),
    addVertex(right, -options.height / 2 + border, 1, 0),
    addVertex(right, options.height / 2 - border, 1, 1),
    addVertex(right - border, options.height / 2 - border, 1, 1),
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Warp an existing x/y mesh once so frame and selection geometry follows the
 * terminal screen. The geometry remains caller-owned and is never disposed.
 */
export function warpGeometryPositions(
  geometry: THREE.BufferGeometry,
  options: TerminalWarpOptions,
): THREE.BufferGeometry {
  validateSpan(options);
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Terminal warp requires a position attribute');
  for (let index = 0; index < position.count; index += 1) {
    const point = terminalWarpPoint(position.getX(index), options);
    const sourceZ = position.getZ(index);
    position.setX(index, point.x);
    position.setZ(index, sourceZ + point.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Return the local-space envelope used for layout and floor clearance. */
export function getTerminalWarpBounds(span: TerminalWarpSpan, samples = 64): TerminalWarpBounds {
  validateSpan(span);
  const count = Math.max(2, Math.floor(samples));
  const radians = clampTerminalCurvatureRadians(span.radians);
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index <= count; index += 1) {
    const point = terminalWarpPoint((index / count - 0.5) * span.width, span);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const minX = radians === 0 ? -span.width / 2 : -(span.width / radians) * Math.sin(radians / 2);
  const maxX = -minX;
  return {
    minX,
    maxX,
    minY: -span.height / 2,
    maxY: span.height / 2,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

/** Conservative arrangement footprint retaining the requested arc span. */
export function getConservativeTerminalArrangementSize(span: TerminalWarpSpan): {
  width: number;
  depth: number;
} {
  return { width: span.width, depth: getTerminalWarpBounds(span).depth };
}

export function createTerminalFrameGeometry(span: TerminalWarpSpan): THREE.BufferGeometry {
  const segments = 32;
  const outer = span.width / 2 + 0.0175;
  const positions: number[] = [];
  const localXs: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number): number => {
    positions.push(x, y, 0);
    localXs.push(x);
    return positions.length / 3 - 1;
  };
  const addQuad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, d, b, c, d);
  };
  const screenSamples = Array.from(
    { length: segments + 1 },
    (_, index) => (index / segments - 0.5) * span.width,
  );
  const rimSamples = [-outer, ...screenSamples, outer];
  const innerTop = span.height / 2;
  const innerBottom = -span.height / 2;
  const outerTop = innerTop + 0.03;
  const outerBottom = innerBottom - 0.03;
  for (const [innerY, outerY] of [
    [innerTop, outerTop],
    [outerBottom, innerBottom],
  ]) {
    for (let index = 0; index < rimSamples.length - 1; index += 1) {
      const x0 = rimSamples[index];
      const x1 = rimSamples[index + 1];
      addQuad(
        addVertex(x0, innerY),
        addVertex(x1, innerY),
        addVertex(x1, outerY),
        addVertex(x0, outerY),
      );
    }
  }
  addQuad(
    addVertex(-outer, outerBottom),
    addVertex(-span.width / 2, outerBottom),
    addVertex(-span.width / 2, outerTop),
    addVertex(-outer, outerTop),
  );
  addQuad(
    addVertex(span.width / 2, outerBottom),
    addVertex(outer, outerBottom),
    addVertex(outer, outerTop),
    addVertex(span.width / 2, outerTop),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  warpGeometryPositions(geometry, span);
  // The frame root's -0.025 offset is in parent Z, not the curved surface normal.
  const position = geometry.getAttribute('position');
  const edgeAngle = clampTerminalCurvatureRadians(span.radians) / 2;
  const edgeCos = Math.cos(edgeAngle);
  const edgeSin = Math.sin(edgeAngle);
  for (let index = 0; index < position.count; index += 1) {
    const localX = localXs[index];
    if (Math.abs(localX) <= span.width / 2) continue;
    const sign = Math.sign(localX);
    const endpoint = terminalWarpPoint((sign * span.width) / 2, span);
    const delta = Math.abs(localX) - span.width / 2;
    position.setX(index, endpoint.x + sign * edgeCos * delta);
    position.setZ(index, endpoint.z + edgeSin * delta + 0.025);
  }
  for (let index = 0; index < position.count; index += 1)
    if (Math.abs(localXs[index]) <= span.width / 2)
      position.setZ(index, position.getZ(index) + 0.025);
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
