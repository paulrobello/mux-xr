import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { controlIdOf, findControl, setControlId } from '../packages/xr-workspace/src/control-ids';

describe('control ids', () => {
  it('sets name and userData.controlId and returns the object', () => {
    const object = new THREE.Group();
    expect(setControlId(object, 'play')).toBe(object);
    expect(object.name).toBe('play');
    expect(object.userData.controlId).toBe('play');
  });

  it('finds a nested control depth-first and returns undefined for a missing id', () => {
    const root = new THREE.Group();
    const row = new THREE.Group();
    const button = setControlId(new THREE.Mesh(), 'next');
    row.add(button);
    root.add(row);
    expect(findControl(root, 'next')).toBe(button);
    expect(findControl(setControlId(new THREE.Group(), 'self'), 'self')?.name).toBe('self');
    expect(findControl(root, 'missing')).toBeUndefined();
  });

  it('climbs to the nearest ancestor with an id and stops at root', () => {
    const outer = setControlId(new THREE.Group(), 'outer');
    const root = new THREE.Group();
    const inner = setControlId(new THREE.Group(), 'inner');
    const leaf = new THREE.Mesh();
    outer.add(root);
    root.add(inner);
    inner.add(leaf);
    const bare = new THREE.Mesh();
    root.add(bare);

    expect(controlIdOf(leaf, root)).toBe('inner');
    expect(controlIdOf(bare, root)).toBeNull();
    expect(controlIdOf(bare)).toBe('outer');
    expect(controlIdOf(new THREE.Mesh())).toBeNull();
  });
});
