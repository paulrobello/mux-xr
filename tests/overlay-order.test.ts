import { keepAbove, OVERLAY_RENDER_ORDER } from '@par/xr-workspace';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

describe('keepAbove', () => {
  it('raises every nested group and leaves meshes alone', () => {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const mesh = new THREE.Mesh();
    inner.add(mesh);
    root.add(inner);
    keepAbove(root);
    expect(root.renderOrder).toBe(OVERLAY_RENDER_ORDER);
    expect(inner.renderOrder).toBe(OVERLAY_RENDER_ORDER);
    expect(mesh.renderOrder).toBe(0);
  });

  it('raises groups added later, at any depth', () => {
    const root = new THREE.Group();
    keepAbove(root);
    const later = new THREE.Group();
    root.add(later);
    const deeper = new THREE.Group();
    later.add(deeper);
    expect(later.renderOrder).toBe(OVERLAY_RENDER_ORDER);
    expect(deeper.renderOrder).toBe(OVERLAY_RENDER_ORDER);
  });

  it('keeps tracking a subtree that is removed and re-added', () => {
    const root = new THREE.Group();
    keepAbove(root);
    const row = new THREE.Group();
    root.add(row);
    root.remove(row);
    root.add(row);
    const child = new THREE.Group();
    row.add(child);
    expect(child.renderOrder).toBe(OVERLAY_RENDER_ORDER);
  });

  it('stops tracking additions after the disposer runs', () => {
    const root = new THREE.Group();
    const stop = keepAbove(root);
    stop();
    const later = new THREE.Group();
    root.add(later);
    expect(later.renderOrder).toBe(0);
  });

  it('uses a custom order', () => {
    const root = new THREE.Group();
    keepAbove(root, 42);
    const later = new THREE.Group();
    root.add(later);
    expect(root.renderOrder).toBe(42);
    expect(later.renderOrder).toBe(42);
  });
});
