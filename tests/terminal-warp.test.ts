import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  clampTerminalCurvatureRadians,
  createCurvedTerminalGeometry,
  createCurvedTerminalSelection,
  createTerminalFrameAccentGeometry,
  createTerminalFrameGeometry,
  getConservativeTerminalArrangementSize,
  getTerminalWarpBounds,
  MAX_TERMINAL_CURVATURE_RADIANS,
  terminalFrameBracketArm,
  terminalWarpPoint,
  warpGeometryPositions,
} from '../src/xr/terminal-warp';

function countInteriorFrameRayHits(
  span: {
    width: number;
    height: number;
    radians: number;
  },
  rootX: number,
  yaw: number,
): number {
  const root = new THREE.Group();
  root.position.set(rootX, 1.5, -1.5);
  root.rotation.y = yaw;
  const frame = new THREE.Mesh(createTerminalFrameGeometry(span));
  frame.position.z = -0.025;
  root.add(frame);
  root.updateMatrixWorld(true);

  const eye = new THREE.Vector3(0, 1.6, 0.1);
  const raycaster = new THREE.Raycaster();
  let hits = 0;
  for (let column = 0; column < 80; column += 1) {
    const x = ((column + 0.5) / 80 - 0.5) * span.width;
    const point = terminalWarpPoint(x, span);
    const target = new THREE.Vector3(point.x, 0, point.z).applyMatrix4(root.matrixWorld);
    raycaster.set(eye, target.sub(eye).normalize());
    if (raycaster.intersectObject(frame, false).length > 0) hits += 1;
  }
  frame.geometry.dispose();
  return hits;
}

describe('curved terminal geometry', () => {
  it('keeps the expanded selection border on the screen cylinder', () => {
    const span = { width: 1.4, height: 0.8, radians: (100 * Math.PI) / 180 };
    const geometry = createCurvedTerminalSelection({
      ...span,
      width: span.width + 0.07,
      height: span.height + 0.07,
      surfaceWidth: span.width,
      border: 0.03,
    });
    const positions = geometry.getAttribute('position');
    for (const column of [0, 8, 16, 24, 32]) {
      const point = terminalWarpPoint((column / 32 - 0.5) * span.width, span);
      let aligned = false;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (
          Math.abs(positions.getX(vertex) - point.x) < 1e-6 &&
          Math.abs(positions.getZ(vertex) - point.z) < 1e-6
        )
          aligned = true;
      }
      expect(aligned).toBe(true);
    }
    geometry.dispose();
  });
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

  it('builds a stepped bezel whose inner edge sits on the screen surface', () => {
    const geometry = createTerminalFrameGeometry({ width: 4, height: 2, radians: 0 });
    const positions = geometry.getAttribute('position');
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) throw new Error('frame geometry must have bounds');
    expect(bounds.min.x).toBeCloseTo(-2.0175);
    expect(bounds.max.x).toBeCloseTo(2.0175);
    expect(bounds.min.y).toBeCloseTo(-1.03);
    expect(bounds.max.y).toBeCloseTo(1.03);
    // Depth runs from the back of the outer wall to the top of the corner brackets.
    expect(bounds.min.z).toBeCloseTo(0.025 - 0.014);
    expect(bounds.max.z).toBeCloseTo(0.025 + 0.008);
    for (let index = 0; index < positions.count; index += 1) {
      const inside =
        Math.abs(positions.getX(index)) < 2 - 1e-6 && Math.abs(positions.getY(index)) < 1 - 1e-6;
      expect(inside).toBe(false);
    }
    expect(geometry.getAttribute('color').count).toBe(positions.count);
    expect(geometry.getAttribute('normal').count).toBe(positions.count);
    geometry.dispose();
  });

  it('keeps interior text-column rays clear of the frame at representative poses', () => {
    for (const radians of [0, Math.PI / 3]) {
      for (const [rootX, yaw] of [
        [-0.87, 0.06],
        [0.87, -0.06],
      ]) {
        expect(countInteriorFrameRayHits({ width: 1.68, height: 0.88, radians }, rootX, yaw)).toBe(
          0,
        );
      }
    }
  });

  it('joins curved selection strips at their exact inner corners', () => {
    for (const width of [1.2, 4, 8.5]) {
      for (const degrees of [0, 30, 60, 90, 100]) {
        const span = { width, height: 2, radians: (degrees * Math.PI) / 180 };
        const geometry = createCurvedTerminalSelection({ ...span, border: 0.03 });
        const positions = geometry.getAttribute('position');
        for (const sign of [-1, 1]) {
          const corner = terminalWarpPoint(sign * (width / 2 - 0.03), span);
          for (const y of [-0.97, 0.97]) {
            let matches = 0;
            for (let index = 0; index < positions.count; index++)
              if (
                Math.abs(positions.getX(index) - corner.x) < 1e-5 &&
                Math.abs(positions.getY(index) - y) < 1e-5 &&
                Math.abs(positions.getZ(index) - corner.z) < 1e-5
              )
                matches++;
            expect(matches).toBeGreaterThanOrEqual(2);
          }
        }
        geometry.dispose();
      }
    }
  });

  it('keeps the warped rim outer corners continuous across curvature and size', () => {
    for (const span of [
      { width: 1.2, height: 0.7 },
      { width: 4, height: 2 },
      { width: 8.5, height: 3.2 },
    ]) {
      for (const degrees of [0, 30, 60, 90, 100]) {
        const radians = (degrees * Math.PI) / 180;
        const geometry = createTerminalFrameGeometry({ ...span, radians });
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) throw new Error('frame geometry must have bounds');
        const edge = terminalWarpPoint(span.width / 2, { ...span, radians });
        // The outer wall runs 0.014 back along the surface normal, which leans outward.
        const expectedX = edge.x + Math.cos(radians / 2) * 0.0175 + Math.sin(radians / 2) * 0.014;
        expect(bounds.min.x).toBeCloseTo(-expectedX, 4);
        expect(bounds.max.x).toBeCloseTo(expectedX, 4);

        const positions = geometry.getAttribute('position');
        for (const y of [-span.height / 2, span.height / 2]) {
          for (let index = 0; index <= 32; index += 1) {
            const x = (index / 32 - 0.5) * span.width;
            const point = terminalWarpPoint(x, { ...span, radians });
            const hasSeamVertex = Array.from(
              { length: positions.count },
              (_, vertex) =>
                [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)] as const,
            ).some(
              ([vertexX, vertexY, vertexZ]) =>
                Math.abs(vertexY - y) < 1e-6 &&
                Math.abs(vertexX - point.x) < 1e-5 &&
                Math.abs(vertexZ - (0.025 + point.z)) < 1e-5,
            );
            expect(hasSeamVertex).toBe(true);
          }
        }
        geometry.dispose();
      }
    }
  });

  it('rounds the outer corners between the side and top rim tangent points', () => {
    for (const span of [
      { width: 1.2, height: 0.7 },
      { width: 4, height: 2 },
      { width: 8.5, height: 3.2 },
    ]) {
      for (const degrees of [0, 60, 100]) {
        const radians = (degrees * Math.PI) / 180;
        const geometry = createTerminalFrameGeometry({ ...span, radians });
        const positions = geometry.getAttribute('position');
        const has = (x: number, y: number, z: number): boolean => {
          for (let index = 0; index < positions.count; index += 1)
            if (
              Math.abs(positions.getX(index) - x) < 1e-5 &&
              Math.abs(positions.getY(index) - y) < 1e-5 &&
              Math.abs(positions.getZ(index) - z) < 1e-5
            )
              return true;
          return false;
        };
        // The outer wall's back edge traces the silhouette.
        const front = 0.025;
        for (const sign of [-1, 1]) {
          const edge = terminalWarpPoint((sign * span.width) / 2, { ...span, radians });
          const along = (rim: number, depth: number): [number, number] => [
            edge.x + sign * Math.cos(radians / 2) * rim + edge.normalX * depth,
            edge.z + Math.sin(radians / 2) * rim + edge.normalZ * depth,
          ];
          for (const ySign of [-1, 1]) {
            const [sideX, sideZ] = along(0.0175, -0.014);
            expect(has(sideX, ySign * (span.height / 2 + 0.03 - 0.0175), front + sideZ)).toBe(true);
            const [topX, topZ] = along(0, -0.014);
            expect(has(topX, ySign * (span.height / 2 + 0.03), front + topZ)).toBe(true);
            const [cornerX, cornerZ] = along(0.0175, -0.014);
            expect(has(cornerX, ySign * (span.height / 2 + 0.03), front + cornerZ)).toBe(false);
          }
        }
        geometry.dispose();
      }
    }
  });

  const FRAME_SIZES = [
    { width: 0.36, height: 0.17 },
    { width: 0.71, height: 0.4 },
    { width: 1.42, height: 0.8 },
    { width: 0.9, height: 1.4 },
    { width: 4, height: 2 },
    { width: 8.5, height: 3.2 },
  ];

  it('builds a finite, fully indexed frame and accent at every size and curvature', () => {
    for (const size of FRAME_SIZES) {
      for (const degrees of [0, 30, 60, 100]) {
        for (const chin of [false, true]) {
          const span = { ...size, radians: (degrees * Math.PI) / 180 };
          for (const geometry of [
            createTerminalFrameGeometry(span, { chin }),
            createTerminalFrameAccentGeometry(span, { chin }),
          ]) {
            const positions = geometry.getAttribute('position');
            expect(positions.count).toBeGreaterThan(0);
            expect(Array.from(positions.array as Float32Array).every(Number.isFinite)).toBe(true);
            const index = geometry.getIndex();
            if (!index) throw new Error('frame geometry must be indexed');
            expect(index.count % 3).toBe(0);
            expect(Math.max(...Array.from(index.array as Uint32Array))).toBeLessThan(
              positions.count,
            );
            geometry.dispose();
          }
        }
      }
    }
  });

  it('keeps the frame and accent off the text area at every size and curvature', () => {
    for (const size of FRAME_SIZES) {
      for (const degrees of [0, 60, 100]) {
        const span = { ...size, radians: (degrees * Math.PI) / 180 };
        for (const geometry of [
          createTerminalFrameGeometry(span, { chin: true }),
          createTerminalFrameAccentGeometry(span, { chin: true }),
        ]) {
          const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
          );
          mesh.position.z = -0.025;
          mesh.updateMatrixWorld(true);
          const raycaster = new THREE.Raycaster();
          for (const u of [-0.499, -0.25, 0, 0.25, 0.499]) {
            for (const v of [-0.499, 0, 0.499]) {
              const point = terminalWarpPoint(u * span.width, span);
              const origin = new THREE.Vector3(
                point.x + point.normalX,
                v * span.height,
                point.z + point.normalZ,
              );
              raycaster.set(origin, new THREE.Vector3(-point.normalX, 0, -point.normalZ));
              expect(raycaster.intersectObject(mesh, false)).toHaveLength(0);
            }
          }
          geometry.dispose();
        }
      }
    }
  });

  it('adds the chin as a separate slab below the bezel only when asked', () => {
    for (const size of FRAME_SIZES) {
      const span = { ...size, radians: Math.PI / 3 };
      const bare = createTerminalFrameGeometry(span);
      const chinned = createTerminalFrameGeometry(span, { chin: true });
      bare.computeBoundingBox();
      chinned.computeBoundingBox();
      expect(bare.boundingBox?.min.y).toBeCloseTo(-(size.height / 2 + 0.03));
      expect(chinned.boundingBox?.min.y).toBeCloseTo(-(size.height / 2 + 0.08));
      expect(chinned.boundingBox?.max.y).toBeCloseTo(size.height / 2 + 0.03);
      expect(chinned.getAttribute('position').count).toBeGreaterThan(
        bare.getAttribute('position').count,
      );
      const bareAccent = createTerminalFrameAccentGeometry(span);
      const chinAccent = createTerminalFrameAccentGeometry(span, { chin: true });
      bareAccent.computeBoundingBox();
      chinAccent.computeBoundingBox();
      expect(bareAccent.boundingBox?.min.y).toBeGreaterThan(-(size.height / 2 + 0.03));
      expect(chinAccent.boundingBox?.min.y).toBeLessThan(-(size.height / 2 + 0.03));
      for (const geometry of [bare, chinned, bareAccent, chinAccent]) geometry.dispose();
    }
  });

  it('scales the corner bracket arm with the pane and never past the half edge', () => {
    expect(terminalFrameBracketArm({ width: 1.42, height: 0.8, radians: 0 })).toBeCloseTo(0.144);
    expect(terminalFrameBracketArm({ width: 8.5, height: 3.2, radians: 0 })).toBeCloseTo(0.3);
    expect(terminalFrameBracketArm({ width: 0.36, height: 0.17, radians: 0 })).toBeCloseTo(0.04);
    for (const size of FRAME_SIZES)
      expect(terminalFrameBracketArm({ ...size, radians: 0 })).toBeLessThan(
        Math.min(size.width, size.height) / 2,
      );
  });
});
