import { createAxisRepeat, createButtonEdges, createPointer } from '@par/xr-workspace';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

function quad(z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

const origin = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3(0, 0, -1);

describe('pointer cast', () => {
  it('returns the nearer of two meshes, then the farther once the nearer is hidden', () => {
    const near = quad(-1);
    const far = quad(-2);
    const roots = [near, far];
    const pointer = createPointer();
    expect(pointer.cast(origin, forward, roots)?.object).toBe(near);
    near.visible = false;
    const hit = pointer.cast(origin, forward, roots);
    expect(hit?.object).toBe(far);
    expect(hit?.distance).toBeCloseTo(2);
    expect(hit?.point.z).toBeCloseTo(-2);
  });

  it('returns null when the root is hidden', () => {
    const root = new THREE.Group();
    root.add(quad(-1));
    root.visible = false;
    root.updateMatrixWorld(true);
    expect(createPointer().cast(origin, forward, [root])).toBeNull();
  });

  it('skips descendants of a hidden intermediate group', () => {
    const root = new THREE.Group();
    const hidden = new THREE.Group();
    const shown = new THREE.Group();
    const behind = quad(-1);
    const front = quad(-2);
    hidden.add(behind);
    shown.add(front);
    root.add(hidden, shown);
    hidden.visible = false;
    root.updateMatrixWorld(true);
    expect(createPointer().cast(origin, forward, [root])?.object).toBe(front);
  });

  it('reports the matching entry of roots', () => {
    const a = new THREE.Group();
    const b = new THREE.Group();
    a.add(quad(-3));
    const target = quad(-1);
    b.add(target);
    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);
    const hit = createPointer().cast(origin, forward, [a, b]);
    expect(hit?.object).toBe(target);
    expect(hit?.root).toBe(b);
  });

  it('picks objects on an extra layer only when that layer is enabled', () => {
    const mesh = quad(-1);
    mesh.layers.set(3);
    expect(createPointer().cast(origin, forward, [mesh])).toBeNull();
    expect(createPointer({ layers: [3] }).cast(origin, forward, [mesh])?.object).toBe(mesh);
  });

  it('limits the cast to far', () => {
    const mesh = quad(-5);
    expect(createPointer({ far: 2 }).cast(origin, forward, [mesh])).toBeNull();
    expect(createPointer({ far: 6 }).cast(origin, forward, [mesh])).not.toBeNull();
  });

  it('castFrom matches a manual cast along the rotated source axis', () => {
    const target = quad(0);
    target.position.set(2, 1, -3);
    target.updateMatrixWorld(true);
    const source = new THREE.Object3D();
    source.position.set(1, 1, 0);
    source.rotateY(-Math.atan2(1, 3));
    source.updateMatrixWorld(true);
    const pointer = createPointer();
    const fromSource = pointer.castFrom(source, [target]);
    expect(fromSource).not.toBeNull();
    const distance = fromSource?.distance ?? 0;
    const direction = new THREE.Vector3(1, 0, -3).normalize();
    const manual = createPointer().cast(new THREE.Vector3(1, 1, 0), direction, [target]);
    expect(manual?.object).toBe(target);
    expect(distance).toBeCloseTo(manual?.distance ?? -1);
  });
});

describe('button edges', () => {
  const pad = (...pressed: boolean[]): Gamepad =>
    ({ buttons: pressed.map((value) => ({ pressed: value })) }) as unknown as Gamepad;

  it('reports press, hold and release for one frame each', () => {
    const edges = createButtonEdges();
    edges.update(pad(false));
    expect([edges.pressed(0), edges.held(0), edges.released(0)]).toEqual([false, false, false]);
    edges.update(pad(true));
    expect([edges.pressed(0), edges.held(0), edges.released(0)]).toEqual([true, true, false]);
    edges.update(pad(true));
    expect([edges.pressed(0), edges.held(0), edges.released(0)]).toEqual([false, true, false]);
    edges.update(pad(false));
    expect([edges.pressed(0), edges.held(0), edges.released(0)]).toEqual([false, false, true]);
    edges.update(pad(false));
    expect(edges.released(0)).toBe(false);
  });

  it('releases every button for a missing gamepad and tracks indices past the first frame', () => {
    const edges = createButtonEdges();
    edges.update(pad(false));
    edges.update(pad(false, false, false, false, true));
    expect(edges.pressed(4)).toBe(true);
    edges.update(null);
    expect(edges.released(4)).toBe(true);
    expect(edges.held(4)).toBe(false);
    edges.update(undefined);
    expect(edges.released(4)).toBe(false);
  });

  it('reset forgets held buttons', () => {
    const edges = createButtonEdges();
    edges.update(pad(true));
    edges.reset();
    edges.update(pad(true));
    expect(edges.pressed(0)).toBe(true);
  });
});

describe('axis repeat', () => {
  it('fires at the crossing, after the initial delay, then every repeat delay', () => {
    const axis = createAxisRepeat();
    expect(axis.update(0.3, 0.1)).toBe(0);
    expect(axis.update(0.9, 0.1)).toBe(1);
    expect(axis.update(0.9, 0.2)).toBe(0);
    expect(axis.update(0.9, 0.19)).toBe(0);
    expect(axis.update(0.9, 0.02)).toBe(1);
    expect(axis.update(0.9, 0.1)).toBe(0);
    expect(axis.update(0.9, 0.02)).toBe(1);
    expect(axis.update(0.9, 0.12)).toBe(1);
  });

  it('fires at once on a sign flip', () => {
    const axis = createAxisRepeat();
    expect(axis.update(0.9, 0.1)).toBe(1);
    expect(axis.update(-0.9, 0.1)).toBe(-1);
    expect(axis.update(-0.9, 0.1)).toBe(0);
  });

  it('resets when the value drops under the threshold', () => {
    const axis = createAxisRepeat();
    expect(axis.update(0.9, 0.1)).toBe(1);
    expect(axis.update(0.2, 0.1)).toBe(0);
    expect(axis.update(0.9, 0.1)).toBe(1);
  });

  it('honours custom options and reset()', () => {
    const axis = createAxisRepeat({ threshold: 0.3, initialDelay: 1, repeatDelay: 0.5 });
    expect(axis.update(0.4, 0)).toBe(1);
    expect(axis.update(0.4, 0.99)).toBe(0);
    expect(axis.update(0.4, 0.02)).toBe(1);
    axis.reset();
    expect(axis.update(0.4, 0)).toBe(1);
  });
});
