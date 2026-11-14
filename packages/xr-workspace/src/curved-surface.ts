import * as THREE from 'three';

/** The largest supported horizontal bend. */
export const MAX_SURFACE_CURVATURE_RADIANS = (100 * Math.PI) / 180;

export interface CurvedSurfaceSpan {
  width: number;
  height: number;
  /** Horizontal bend in radians. Zero is a flat screen. */
  radians: number;
}

export interface CurvedSurfaceOptions extends CurvedSurfaceSpan {
  /** Number of horizontal subdivisions used by generated surfaces. */
  segments?: number;
}

export function validateSpan(span: CurvedSurfaceSpan): void {
  if (!Number.isFinite(span.width) || span.width <= 0) {
    throw new RangeError('Curved surface width must be a finite positive number');
  }
  if (!Number.isFinite(span.height) || span.height <= 0) {
    throw new RangeError('Curved surface height must be a finite positive number');
  }
}

export function clampSurfaceCurvatureRadians(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return THREE.MathUtils.clamp(radians, 0, MAX_SURFACE_CURVATURE_RADIANS);
}

/** Map normalized horizontal coordinates onto a concave cylindrical screen. */
export function curvedSurfacePoint(
  x: number,
  span: CurvedSurfaceSpan,
): { x: number; z: number; normalX: number; normalZ: number } {
  validateSpan(span);
  const radians = clampSurfaceCurvatureRadians(span.radians);
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
export function createCurvedSurfaceGeometry(options: CurvedSurfaceOptions): THREE.BufferGeometry {
  validateSpan(options);
  const segmentCount = Math.max(1, Math.floor(options.segments ?? 32));
  const radians = clampSurfaceCurvatureRadians(options.radians);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= 1; row += 1) {
    const y = (row - 0.5) * options.height;
    for (let column = 0; column <= segmentCount; column += 1) {
      const u = column / segmentCount;
      const point = curvedSurfacePoint((u - 0.5) * options.width, {
        width: options.width,
        height: options.height,
        radians,
      });
      positions.push(point.x, y, point.z);
      normals.push(point.normalX, 0, point.normalZ);
      // Keep x left-to-right and y bottom-to-top for hit testing.
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
