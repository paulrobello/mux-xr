import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/xr/labels', () => import('./helpers/labels'));

import type { HandContactProbe } from '../src/xr/hand-contact';
import { createScalableLabel } from '../src/xr/labels';
import { createWristMenuWatch } from '../src/xr/wrist-menu-watch';

function makeWatch(): ReturnType<typeof createWristMenuWatch> {
  return createWristMenuWatch(createScalableLabel('Menu', 0.052, 0.035));
}

function probe(
  watch: ReturnType<typeof createWristMenuWatch>,
  localPoint: THREE.Vector3,
  radius = 0.004,
): HandContactProbe {
  watch.root.updateMatrixWorld(true);
  return { point: localPoint.clone().applyMatrix4(watch.root.matrixWorld), radius };
}

describe('wrist menu watch', () => {
  it('requires withdrawal and fires once per touch entry', () => {
    const watch = makeWatch();
    const wrist = new THREE.Vector3();
    watch.update(wrist, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    watch.setVisible(true);
    const far = [probe(watch, new THREE.Vector3(0, 0, 0.1))];
    const near = [probe(watch, new THREE.Vector3(0, 0, 0.055))];
    const touch = [probe(watch, new THREE.Vector3(0, 0, 0.01))];
    expect(watch.updateTouch(touch)).toBe(false);
    expect(watch.near).toBe(true);
    expect(watch.updateTouch(far)).toBe(false);
    expect(watch.near).toBe(false);
    expect(watch.updateTouch(near)).toBe(false);
    expect(watch.updateTouch(touch)).toBe(true);
    expect(watch.updateTouch(touch)).toBe(false);
    expect(watch.updateTouch(far)).toBe(false);
    expect(watch.updateTouch(touch)).toBe(true);
    watch.dispose();
  });

  it('accepts contact on every case side and resets on tracking loss', () => {
    const watch = makeWatch();
    watch.update(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    watch.setVisible(true);
    const sides = [
      new THREE.Vector3(0.034, 0, 0),
      new THREE.Vector3(-0.034, 0, 0),
      new THREE.Vector3(0, 0.026, 0),
      new THREE.Vector3(0, -0.026, 0),
      new THREE.Vector3(0, 0, 0.01),
      new THREE.Vector3(0, 0, -0.01),
      new THREE.Vector3(0.022, -0.012, -0.03),
    ];
    for (const side of sides) {
      expect(watch.updateTouch([probe(watch, new THREE.Vector3(0.1, 0, 0))])).toBe(false);
      expect(watch.updateTouch([probe(watch, side)])).toBe(true);
      expect(watch.updateTouch(null)).toBe(false);
      expect(watch.near).toBe(false);
    }
    watch.setVisible(false);
    watch.setVisible(true);
    expect(watch.updateTouch(null)).toBe(false);
    watch.dispose();
  });

  it('moves and rotates with the supplied pose without mutating inputs', () => {
    const watch = makeWatch();
    const wrist = new THREE.Vector3(1, 2, 3);
    const forward = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    watch.update(wrist, forward, normal);
    expect(wrist).toEqual(new THREE.Vector3(1, 2, 3));
    expect(forward).toEqual(new THREE.Vector3(0, 1, 0));
    expect(normal).toEqual(new THREE.Vector3(0, 0, 1));
    expect(watch.root.position.distanceTo(new THREE.Vector3(1, 2.012, 3.03))).toBeLessThan(1e-6);
    watch.dispose();
  });

  it('shows local 12-hour time and updates only when the minute changes', () => {
    const watch = makeWatch();
    const button = watch.root.children.find((child) => child.userData.inputAction === 'wristMenu');
    expect(button).toBeDefined();
    const noon = new Date(2026, 0, 2, 12, 0, 5, 0).getTime();
    watch.updateTime(noon);
    expect(button?.userData.labelText).toBe('12:00\nPM');
    watch.updateTime(noon + 30_000);
    expect(button?.userData.labelText).toBe('12:00\nPM');
    watch.updateTime(noon + 60_000);
    expect(button?.userData.labelText).toBe('12:01\nPM');
    const midnight = new Date(2026, 0, 3, 0, 0, 1, 0).getTime();
    watch.updateTime(midnight);
    expect(button?.userData.labelText).toBe('12:00\nAM');
    watch.dispose();
  });

  it('disposes owned case and strap resources but preserves the button resource', () => {
    const buttonGeometry = new THREE.PlaneGeometry(0.04, 0.03);
    const buttonMaterial = new THREE.MeshBasicMaterial();
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
    const geometryDispose = vi.spyOn(buttonGeometry, 'dispose');
    const materialDispose = vi.spyOn(buttonMaterial, 'dispose');
    const watch = createWristMenuWatch(button);
    watch.dispose();
    watch.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(watch.root.children).toHaveLength(0);
  });
});
