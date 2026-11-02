import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  clampTerminalCurvatureRadians,
  createCurvedTerminalGeometry,
  createCurvedTerminalSelection,
  getConservativeTerminalArrangementSize,
  getTerminalWarpBounds,
  MAX_TERMINAL_CURVATURE_RADIANS,
  warpGeometryPositions,
} from '../src/xr/terminal-warp';

describe('curved terminal geometry', () => {
  it('clamps curvature to the supported 100 degree maximum', () => {
    expect(clampTerminalCurvatureRadians(-1)).toBe(0);
    expect(clampTerminalCurvatureRadians(10)).toBe(MAX_TERMINAL_CURVATURE_RADIANS);
    expect(clampTerminalCurvatureRadians(Number.NaN)).toBe(0);
  });

  it('keeps a flat screen endpoints and front normals unchanged', () => {
    const geometry = createCurvedTerminalGeometry({ width: 4, height: 2, radians: 0, segments: 2 });
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([
      -2, -1, 0, 0, -1, 0, 2, -1, 0, -2, 1, 0, 0, 1, 0, 2, 1, 0,
    ]);
    expect(Array.from(geometry.getAttribute('normal').array)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it('preserves logical UV orientation while curving the surface', () => {
    const geometry = createCurvedTerminalGeometry({
      width: 4,
      height: 2,
      radians: Math.PI / 2,
      segments: 2,
    });
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual([
      0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1,
    ]);
    const positions = geometry.getAttribute('position');
    expect(positions.getZ(1)).toBeCloseTo(0);
    expect(positions.getZ(0)).toBeGreaterThan(0);
    expect(positions.getZ(2)).toBeGreaterThan(0);
  });

  it('reports the curved depth and preserves the requested envelope width', () => {
    const bounds = getTerminalWarpBounds({ width: 4, height: 2, radians: Math.PI / 2 });
    expect(bounds.width).toBeCloseTo(4 * (Math.sin(Math.PI / 4) / (Math.PI / 4)));
    expect(bounds.depth).toBeGreaterThan(0);
    expect(bounds.minY).toBe(-1);
    expect(bounds.maxY).toBe(1);
  });

  it('builds a subdivided curved selection outline with UVs', () => {
    const geometry = createCurvedTerminalSelection({ width: 4, height: 2, radians: Math.PI / 2 });
    expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.index?.count).toBeGreaterThan(12);
    expect(geometry.getAttribute('position').getZ(0)).toBeGreaterThan(0);
    expect(
      getConservativeTerminalArrangementSize({ width: 4, height: 2, radians: Math.PI / 2 }),
    ).toEqual({
      width: 4,
      depth: expect.any(Number),
    });
  });

  it('winds every flat selection triangle toward the front', () => {
    const geometry = createCurvedTerminalSelection({ width: 4, height: 2, radians: 0 });
    const positions = geometry.getAttribute('position');
    const indices = geometry.index;
    if (!indices) throw new Error('selection geometry must be indexed');
    for (let index = 0; index < indices.count; index += 3) {
      const a = indices.getX(index) * 3;
      const b = indices.getX(index + 1) * 3;
      const c = indices.getX(index + 2) * 3;
      const abX = positions.array[b] - positions.array[a];
      const abY = positions.array[b + 1] - positions.array[a + 1];
      const acX = positions.array[c] - positions.array[a];
      const acY = positions.array[c + 1] - positions.array[a + 1];
      expect(abX * acY - abY * acX).toBeGreaterThan(0);
    }
  });

  it('warps caller-owned geometry in place without taking disposal ownership', () => {
    const geometry = new THREE.PlaneGeometry(4, 2, 2, 1);
    const warped = warpGeometryPositions(geometry, { width: 4, height: 2, radians: Math.PI / 2 });
    expect(warped).toBe(geometry);
    expect(geometry.getAttribute('position').getZ(0)).toBeGreaterThan(0);
    geometry.dispose();
  });
});
