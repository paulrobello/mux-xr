import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { measurePanelBounds } from '../src/xr/panel-bounds';

const box = (width: number, height: number, x: number, y: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.02));
  mesh.position.set(x, y, 0);
  return mesh;
};

describe('measurePanelBounds', () => {
  it('includes mixed panel geometry and controls in root-local bounds', () => {
    const root = new THREE.Group();
    root.add(box(2, 1, 0, 0), box(0.2, 0.2, -1.2, 0.8), box(0.4, 0.1, 1.3, -0.7));

    const measured = measurePanelBounds(root);

    expect(measured.size.width).toBeCloseTo(2.8);
    expect(measured.size.height).toBeCloseTo(1.65);
    expect(measured.center.x).toBeCloseTo(0.1);
    expect(measured.center.y).toBeCloseTo(0.075);
  });

  it('applies the root physical scale but returns an unscaled local center', () => {
    const root = new THREE.Group();
    root.scale.set(2, 3, 1);
    root.add(box(2, 1, 0, 0));

    const measured = measurePanelBounds(root);

    expect(measured.size.width).toBeCloseTo(4);
    expect(measured.size.height).toBeCloseTo(3);
    expect(measured.center.toArray()).toEqual([0, 0, 0]);
  });

  it('is invariant to the root translation and rotation', () => {
    const root = new THREE.Group();
    root.add(box(2, 1, 0.4, -0.2));
    const before = measurePanelBounds(root);
    root.position.set(8, -4, 3);
    root.rotation.set(0.4, -0.7, 1.1);
    const after = measurePanelBounds(root);

    expect(after.size.width).toBeCloseTo(before.size.width);
    expect(after.size.height).toBeCloseTo(before.size.height);
    expect(after.center.x).toBeCloseTo(before.center.x);
    expect(after.center.y).toBeCloseTo(before.center.y);
  });

  it('preserves an asymmetric control offset in the local center', () => {
    const root = new THREE.Group();
    root.add(box(2, 1, 0, 0), box(0.4, 0.2, 1.3, 0));

    const measured = measurePanelBounds(root);

    expect(measured.center.x).toBeCloseTo(0.25);
    expect(measured.center.y).toBeCloseTo(0);
  });

  it('skips Troika glyph geometry when the fitted label plane is present', () => {
    const root = new THREE.Group();
    const label = box(1, 0.2, 0, 0);
    const glyph = box(10, 10, 0, 0);
    label.userData.labelTextObject = glyph;
    label.add(glyph);
    root.add(label);

    const measured = measurePanelBounds(root);

    expect(measured.size.width).toBeCloseTo(1);
    expect(measured.size.height).toBeCloseTo(0.2);
  });
});
