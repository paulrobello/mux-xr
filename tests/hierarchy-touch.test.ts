import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createHierarchyTouch } from '../src/xr/hierarchy-touch';

function node(x: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03));
  mesh.position.set(x, 0, 0);
  mesh.updateMatrixWorld(true);
  return mesh;
}

// Index and thumb tips straddling `at`, `gap` metres apart.
function tips(at: THREE.Vector3, gap: number): [THREE.Vector3, THREE.Vector3] {
  return [
    at.clone().add(new THREE.Vector3(0, gap / 2, 0)),
    at.clone().add(new THREE.Vector3(0, -gap / 2, 0)),
  ];
}

const OPEN = 0.08;
const CLOSED = 0.02;

describe('hierarchy touch', () => {
  it('commits the node a pinch closed and opened on', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const b = node(0.3);
    const source = {};
    const at = new THREE.Vector3(0, 0.05, 0);
    expect(touch.sample(source, ...tips(at, OPEN), [a, b])).toEqual({
      hovered: a,
      committed: null,
    });
    expect(touch.near(source)).toBe(true);
    expect(touch.sample(source, ...tips(at, CLOSED), [a, b]).committed).toBeNull();
    expect(touch.sample(source, ...tips(at, OPEN), [a, b])).toEqual({ hovered: a, committed: a });
  });

  it('ignores a far hand and a pinch that closed away from every node', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const source = {};
    const far = new THREE.Vector3(0, 0.3, 0);
    expect(touch.sample(source, ...tips(far, OPEN), [a]).hovered).toBeNull();
    expect(touch.near(source)).toBe(false);
    touch.sample(source, ...tips(far, CLOSED), [a]);
    const near = new THREE.Vector3(0, 0.05, 0);
    expect(touch.sample(source, ...tips(near, CLOSED), [a]).hovered).toBe(a);
    expect(touch.sample(source, ...tips(near, OPEN), [a]).committed).toBeNull();
  });

  it('keeps a held node through closing drift and cancels when the hand leaves', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const b = node(0.12);
    const source = {};
    touch.sample(source, ...tips(new THREE.Vector3(0.02, 0.05, 0), OPEN), [a, b]);
    touch.sample(source, ...tips(new THREE.Vector3(0.02, 0.05, 0), CLOSED), [a, b]);
    expect(
      touch.sample(source, ...tips(new THREE.Vector3(0.1, 0.05, 0), CLOSED), [a, b]).hovered,
    ).toBe(a);
    touch.sample(source, ...tips(new THREE.Vector3(0, 0.3, 0), CLOSED), [a, b]);
    expect(touch.sample(source, ...tips(new THREE.Vector3(0, 0.3, 0), OPEN), [a, b])).toEqual({
      hovered: null,
      committed: null,
    });
  });

  it('waits for an open pinch before latching after tracking returns', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const source = {};
    const at = new THREE.Vector3(0, 0.05, 0);
    touch.sample(source, ...tips(new THREE.Vector3(0, 0.4, 0), OPEN), [a]);
    touch.sample(source, ...tips(new THREE.Vector3(0, 0.4, 0), CLOSED), [a]);
    touch.sample(source, null, null, [a]);
    expect(touch.sample(source, ...tips(at, CLOSED), [a]).hovered).toBe(a);
    expect(touch.sample(source, ...tips(at, OPEN), [a]).committed).toBeNull();
    touch.sample(source, ...tips(at, CLOSED), [a]);
    expect(touch.sample(source, ...tips(at, OPEN), [a]).committed).toBe(a);
  });

  it('prefers the node whose bounds the pinch is deepest inside', () => {
    const touch = createHierarchyTouch();
    const big = new THREE.Mesh(new THREE.SphereGeometry(0.2));
    big.updateMatrixWorld(true);
    const small = node(0.15);
    expect(touch.nearest(new THREE.Vector3(0.15, 0, 0), [small, big], 0.08)).toBe(big);
    expect(touch.nearest(new THREE.Vector3(0.15, 0, 0), [big, small], 0.08)).toBe(big);
  });

  it('drops a node that is rebuilt away or hidden mid-pinch', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const source = {};
    const at = new THREE.Vector3(0, 0.05, 0);
    touch.sample(source, ...tips(at, OPEN), [a]);
    touch.sample(source, ...tips(at, CLOSED), [a]);
    expect(touch.sample(source, ...tips(at, OPEN), []).committed).toBeNull();
    touch.sample(source, ...tips(at, OPEN), [a]);
    touch.sample(source, ...tips(at, CLOSED), [a]);
    a.visible = false;
    expect(touch.sample(source, ...tips(at, OPEN), [a]).committed).toBeNull();
  });

  it('loses the hover when tracking drops and finds the nearest node in reach', () => {
    const touch = createHierarchyTouch();
    const a = node(0);
    const b = node(0.3);
    const source = {};
    touch.sample(source, ...tips(new THREE.Vector3(0, 0.05, 0), OPEN), [a, b]);
    expect(touch.sample(source, null, null, [a, b]).hovered).toBeNull();
    expect(touch.near(source)).toBe(false);
    expect(touch.nearest(new THREE.Vector3(0.28, 0.05, 0), [a, b], 0.08)).toBe(b);
    expect(touch.nearest(new THREE.Vector3(0.15, 0.4, 0), [a, b], 0.08)).toBeNull();
  });
});
