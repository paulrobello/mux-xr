import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSpaceBackground } from '../src/xr/space-background';

function positions(root: THREE.Object3D): number[] {
  const values: number[] = [];
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!attribute) return;
    for (let index = 0; index < attribute.count; index += 1) {
      values.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    }
  });
  return values;
}

function maxDistance(root: THREE.Object3D): number {
  let maximum = 0;
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!attribute) return;
    for (let index = 0; index < attribute.count; index += 1) {
      maximum = Math.max(
        maximum,
        new THREE.Vector3(
          attribute.getX(index),
          attribute.getY(index),
          attribute.getZ(index),
        ).length(),
      );
    }
  });
  return maximum;
}

describe('observatory exterior space', () => {
  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createSpaceBackground();
    const second = createSpaceBackground();
    expect(first.root.name).toBe('observatory-exterior-space');
    expect(positions(first.root)).toEqual(positions(second.root));
    expect(positions(first.root).every(Number.isFinite)).toBe(true);
    expect(first.root.children).toHaveLength(4);
    expect(maxDistance(first.root)).toBeLessThan(80);
    first.dispose();
    second.dispose();
  });

  it('uses a soft shared sprite with restrained per-star size variation', () => {
    const background = createSpaceBackground();
    const stars = background.root.getObjectByName('observatory-exterior-stars') as
      | THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
      | undefined;
    expect(stars).toBeDefined();
    const scales = stars?.geometry.getAttribute('starScale');
    const texture = stars?.material.map;
    expect(scales?.count).toBe(640);
    const scaleValues = Array.from(
      { length: scales?.count ?? 0 },
      (_, index) => scales?.getX(index) ?? 0,
    );
    expect(Math.min(...scaleValues)).toBeGreaterThanOrEqual(0.62);
    expect(Math.max(...scaleValues)).toBeLessThanOrEqual(1.5);
    expect(new Set(scaleValues).size).toBeGreaterThan(2);
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    const pixels = (texture as THREE.DataTexture).image.data as Uint8Array;
    const center = pixels[(32 * 64 + 32) * 4 + 3];
    const edge = pixels[(32 * 64 + 0) * 4 + 3];
    expect(center).toBeGreaterThan(edge);
    expect(edge).toBe(0);
    expect(stars?.material.transparent).toBe(true);
    expect(stars?.material.depthWrite).toBe(false);
    background.dispose();
  });

  it('updates a bounded reusable shooting star only while visible', () => {
    const background = createSpaceBackground();
    const meteor = background.root.getObjectByName('observatory-exterior-shooting-star') as
      | THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
      | undefined;
    expect(meteor).toBeDefined();
    background.root.visible = true;
    for (let index = 0; index < 210; index += 1) background.update(0.25);
    expect(meteor?.visible).toBe(true);
    const geometry = meteor?.geometry;
    const position = meteor?.position.clone();
    background.update(0.05);
    expect(position && meteor?.position.distanceTo(position)).toBeGreaterThan(0);
    background.root.visible = false;
    background.update(60);
    expect(meteor?.visible).toBe(true);
    expect(meteor?.geometry).toBe(geometry);
    background.dispose();
  });

  it('disposes owned resources idempotently and detaches the root', () => {
    const background = createSpaceBackground();
    const geometries = background.root.children.map((child) => (child as THREE.Mesh).geometry);
    const dispose = vi.spyOn(geometries[0], 'dispose');
    const stars = background.root.getObjectByName('observatory-exterior-stars') as
      | THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
      | undefined;
    const textureDispose = vi.spyOn(stars?.material.map as THREE.Texture, 'dispose');
    background.dispose();
    background.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(background.root.parent).toBeNull();
  });
});
