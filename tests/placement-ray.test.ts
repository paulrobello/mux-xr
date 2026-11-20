import { PlacementRays } from '@par/xr-workspace';
import * as THREE from 'three';
import { expect, test } from 'vitest';

const source = (handedness: XRHandedness) => ({ handedness }) as XRInputSource;

test('placement rays show valid, invalid, and open-air targets and clean up stale hands', () => {
  const scene = new THREE.Scene();
  const rays = new PlacementRays(scene);
  const right = source('right');
  const left = source('left');
  rays.update([
    {
      source: right,
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      distance: 0.6,
      contact: true,
      valid: true,
    },
    {
      source: left,
      origin: new THREE.Vector3(0.1, 0, 0),
      direction: new THREE.Vector3(0, 0, -1),
      distance: 1,
      contact: false,
      valid: false,
    },
  ]);
  expect(scene.getObjectByName('placement-ray-right')?.visible).toBe(true);
  expect(scene.getObjectByName('placement-ray-left')?.visible).toBe(true);
  expect(
    scene.getObjectByName('placement-ray-left')?.getObjectByName('placement-ray-contact')?.visible,
  ).toBe(false);
  rays.update([]);
  expect(scene.getObjectByName('placement-ray-right')).toBeUndefined();
  expect(scene.getObjectByName('placement-ray-left')).toBeUndefined();
  rays.clear();
  expect(rays.group.children).toHaveLength(0);
});

test('placement ray objects and shared GPU resources persist while the contact stays aligned', () => {
  const scene = new THREE.Scene();
  const rays = new PlacementRays(scene);
  const right = source('right');
  const target = {
    source: right,
    origin: new THREE.Vector3(1, 2, 3),
    direction: new THREE.Vector3(0, 0, -1),
    distance: 0.6,
    contact: true,
    valid: true,
  };
  rays.update([target]);
  const root = scene.getObjectByName('placement-ray-right');
  const beam = root?.getObjectByName('placement-ray-beam') as THREE.Mesh | undefined;
  const dot = root?.getObjectByName('placement-ray-contact') as THREE.Mesh | undefined;
  if (!root || !beam || !dot) throw Error('missing placement ray');
  root.updateMatrixWorld(true);
  const firstMaterial = beam.material;
  const firstGeometry = beam.geometry;
  const tip = beam.localToWorld(new THREE.Vector3(0, 0.5, 0));
  expect(tip.distanceTo(dot.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
  rays.update([target]);
  expect(scene.getObjectByName('placement-ray-right')).toBe(root);
  expect(beam.material).toBe(firstMaterial);
  expect(beam.geometry).toBe(firstGeometry);
});
