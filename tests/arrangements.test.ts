import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type ArrangementPanelSize, calculateArrangement } from '../src/xr/arrangements';

const size = (width = 1.42, height = 0.8): ArrangementPanelSize => ({ width, height });
const normal = (pose: ReturnType<typeof calculateArrangement>[number]): THREE.Vector3 =>
  new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quaternion);

const projectedQuad = (
  pose: ReturnType<typeof calculateArrangement>[number],
  panel: ArrangementPanelSize,
): Array<{ x: number; y: number }> => {
  const halfWidth = (panel.width + 0.12) / 2;
  const halfHeight = (panel.height + 0.12) / 2;
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => {
    const point = new THREE.Vector3(x, y, 0).applyQuaternion(pose.quaternion).add(pose.position);
    return { x: point.x / -point.z, y: point.y / -point.z };
  });
};

const overlaps = (
  first: Array<{ x: number; y: number }>,
  second: Array<{ x: number; y: number }>,
): boolean => {
  const axes: Array<{ x: number; y: number }> = [];
  for (const quad of [first, second]) {
    for (let index = 0; index < quad.length; index += 1) {
      const a = quad[index];
      const b = quad[(index + 1) % quad.length];
      axes.push({ x: -(b.y - a.y), y: b.x - a.x });
    }
  }
  return axes.every((axis) => {
    const a = first.map((point) => point.x * axis.x + point.y * axis.y);
    const b = second.map((point) => point.x * axis.x + point.y * axis.y);
    return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
  });
};

describe('panel arrangements', () => {
  it('keeps a two-panel sphere near the forward working area', () => {
    const poses = calculateArrangement('sphere', [size(1.72, 1.1), size(1.72, 1.1)]);
    for (const pose of poses) {
      expect(Math.abs(Math.atan2(pose.position.x, -pose.position.z))).toBeLessThan(0.4);
      expect(pose.position.length()).toBeLessThan(3);
    }
  });
  it('returns no poses for no panels and a front-center pose for one', () => {
    expect(calculateArrangement('row', [])).toEqual([]);
    const [pose] = calculateArrangement('sphere', [size()]);
    expect(pose.position.x).toBeCloseTo(0);
    expect(pose.position.y).toBeCloseTo(0);
    expect(pose.position.z).toBeLessThan(-2.2);
    expect(normal(pose).dot(pose.position.clone().negate().normalize())).toBeCloseTo(1);
  });

  it.each(['row', 'grid', 'arc', 'sphere'] as const)(
    'keeps %s poses finite and inward-facing',
    (pattern) => {
      const poses = calculateArrangement(
        pattern,
        Array.from({ length: 12 }, () => size()),
      );
      expect(poses).toHaveLength(12);
      for (const pose of poses) {
        expect(pose.position.toArray().every(Number.isFinite)).toBe(true);
        expect(pose.quaternion.toArray().every(Number.isFinite)).toBe(true);
        expect(normal(pose).dot(pose.position.clone().negate().normalize())).toBeGreaterThan(0.999);
      }
    },
  );

  it('keeps row and grid flat while arranging mixed sizes without overlap', () => {
    const sizes = [
      size(1.1, 0.6),
      size(2, 1),
      size(0.8, 0.7),
      size(1.4, 0.9),
      size(1, 0.5),
      size(1.7, 0.8),
    ];
    const row = calculateArrangement('row', sizes);
    expect(new Set(row.map((pose) => pose.position.y))).toHaveLength(1);
    expect(new Set(row.map((pose) => pose.position.z))).toHaveLength(1);
    for (let index = 1; index < row.length; index += 1) {
      expect(row[index].position.x - row[index - 1].position.x).toBeGreaterThan(
        (sizes[index].width + sizes[index - 1].width) / 2,
      );
      expect(
        row[index].position.x -
          row[index - 1].position.x -
          (sizes[index].width + sizes[index - 1].width) / 2,
      ).toBeGreaterThanOrEqual(0.12 - 1e-6);
    }
    const grid = calculateArrangement('grid', sizes);
    expect(new Set(grid.map((pose) => pose.position.z))).toHaveLength(1);
    expect(new Set(grid.map((pose) => pose.position.x))).not.toHaveLength(1);
  });

  it('uses distinct geometry for each pattern and a common radius for curved layouts', () => {
    const sizes = Array.from({ length: 6 }, () => size());
    const row = calculateArrangement('row', sizes);
    const grid = calculateArrangement('grid', sizes);
    const arc = calculateArrangement('arc', sizes);
    const sphere = calculateArrangement('sphere', sizes);
    expect(arc.map((pose) => pose.position.toArray())).not.toEqual(
      row.map((pose) => pose.position.toArray()),
    );
    expect(sphere.map((pose) => pose.position.toArray())).not.toEqual(
      grid.map((pose) => pose.position.toArray()),
    );
    const arcRadii = arc.map((pose) => Math.hypot(pose.position.x, pose.position.z));
    const sphereRadii = sphere.map((pose) => pose.position.length());
    expect(Math.max(...arcRadii) - Math.min(...arcRadii)).toBeLessThan(1e-9);
    expect(Math.max(...sphereRadii) - Math.min(...sphereRadii)).toBeLessThan(1e-9);
    expect(sphere.every((pose) => pose.position.z < 0)).toBe(true);
  });

  it('keeps a large spherical grid unique without collapsed edge columns or rows', () => {
    const poses = calculateArrangement(
      'sphere',
      Array.from({ length: 64 }, () => size()),
    );
    const centers = new Set(
      poses.map((pose) =>
        pose.position
          .toArray()
          .map((value) => value.toFixed(8))
          .join(','),
      ),
    );
    expect(centers).toHaveLength(64);
    expect(new Set(poses.slice(0, 8).map((pose) => pose.position.x))).toHaveLength(8);
    expect(
      new Set(poses.filter((_, index) => index % 8 === 0).map((pose) => pose.position.y)),
    ).toHaveLength(8);
  });

  it.each([6, 12] as const)('separates mixed-size spherical neighbors for %i panels', (count) => {
    const sizes = Array.from({ length: count }, (_, index) =>
      size(0.8 + (index % 4) * 0.35, 0.5 + (index % 3) * 0.2),
    );
    const poses = calculateArrangement('sphere', sizes);
    const columns = Math.ceil(Math.sqrt(count));
    for (let index = 0; index < count; index += 1) {
      if (index % columns < columns - 1 && index + 1 < count) {
        expect(poses[index].position.distanceTo(poses[index + 1].position)).toBeGreaterThan(
          (sizes[index].width + sizes[index + 1].width) / 2,
        );
        expect(
          poses[index].position.distanceTo(poses[index + 1].position) -
            (sizes[index].width + sizes[index + 1].width) / 2,
        ).toBeGreaterThanOrEqual(0.12 - 1e-6);
      }
      if (index + columns < count) {
        expect(poses[index].position.distanceTo(poses[index + columns].position)).toBeGreaterThan(
          (sizes[index].height + sizes[index + columns].height) / 2,
        );
        expect(
          poses[index].position.distanceTo(poses[index + columns].position) -
            (sizes[index].height + sizes[index + columns].height) / 2,
        ).toBeGreaterThanOrEqual(0.12 - 1e-6);
      }
    }
  });

  it('keeps a two-panel sphere close and in the forward viewing area', () => {
    const poses = calculateArrangement('sphere', [size(), size()]);
    expect(poses[0].position.length()).toBeLessThan(3);
    expect(poses[1].position.length()).toBeLessThan(3);
    expect(Math.abs(Math.atan2(poses[0].position.x, -poses[0].position.z))).toBeLessThan(0.4);
    expect(Math.abs(Math.atan2(poses[1].position.x, -poses[1].position.z))).toBeLessThan(0.4);
  });

  it.each(['row', 'grid', 'arc', 'sphere'] as const)(
    'separates projected mixed-size %s panels',
    (pattern) => {
      const sizes = [
        size(0.3, 0.3),
        size(3.2, 0.45),
        size(0.45, 2.2),
        size(1.8, 1.1),
        size(0.5, 0.35),
        size(2.4, 1.7),
      ];
      const poses = calculateArrangement(pattern, sizes);
      for (let first = 0; first < poses.length; first += 1) {
        const firstQuad = projectedQuad(poses[first], sizes[first]);
        expect(
          firstQuad.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
        ).toBe(true);
        for (let second = first + 1; second < poses.length; second += 1)
          expect(overlaps(firstQuad, projectedQuad(poses[second], sizes[second]))).toBe(false);
      }
    },
  );
});
