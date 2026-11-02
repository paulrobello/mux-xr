import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    font = '';
    fontSize = 0;
    maxWidth = 0;
    anchorX: number | string = 0;
    anchorY: number | string = 0;
    textAlign = '';
    whiteSpace = '';
    lineHeight: number | string = 'normal';
    overflowWrap = '';
    color: number | string | THREE.Color = 0;
    depthOffset = 0;
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import { createRadialMenu, type RadialMenuAction } from '../src/xr/radial-menu';

function actionNodes(menu: ReturnType<typeof createRadialMenu>): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  menu.root.traverse((object) => {
    if (object.userData.radialAction) nodes.push(object);
  });
  return nodes;
}

describe('animated radial menu', () => {
  it('animates from center to a clockwise, upright five-action fan', () => {
    const menu = createRadialMenu();
    menu.root.scale.setScalar(0.8);
    menu.open();
    menu.update(0.16);
    expect(menu.interactive).toBe(false);
    const targets = actionNodes(menu).filter(
      (child) => child.userData.radialAction !== 'cancel' && child.name.startsWith('radial-menu-'),
    );
    expect(new Set(targets.map((target) => target.userData.radialAction))).toEqual(
      new Set(['keyboard', 'commands', 'layout', 'warp', 'widgets']),
    );
    expect(targets.every((target) => target.position.length() < 0.01)).toBe(true);
    menu.update(0.16);
    expect(targets.every((target) => target.position.y < -0.2)).toBe(true);
    const stackDistance = targets[0].position.length();
    menu.update(0.48);
    menu.update(0.01);
    expect(menu.interactive).toBe(true);
    const angles = targets.map((target) => target.userData.finalAngle as number);
    expect(angles[0]).toBeCloseTo(Math.PI / 2);
    expect(angles[1]).toBeLessThan(angles[0]);
    expect(targets[0].position.length()).toBeCloseTo(0.245);
    expect(stackDistance).toBeCloseTo(0.245, 1);
    for (const target of targets) {
      const label = target.children.find((child) => child.userData.labelText) ?? target.children[1];
      expect(label.rotation.z + target.rotation.z).toBeCloseTo(0);
    }
    expect(menu.root.scale.x).toBeCloseTo(0.8);
    menu.dispose();
  });

  it('propagates pick metadata and handles close and repeated open without leaks', () => {
    const menu = createRadialMenu();
    expect(menu.root.userData).toMatchObject({
      inputAction: 'grabRadial',
      rootUIgrabbable: true,
      scaleLimits: [0.4, 1.6],
    });
    menu.open();
    menu.update(0.8);
    const actions = actionNodes(menu)
      .map((child) => child.userData.radialAction)
      .filter(Boolean) as RadialMenuAction[];
    expect(actions).toContain('cancel');
    expect(actions).toContain('keyboard');
    menu.setHovered('keyboard');
    menu.close();
    expect(menu.interactive).toBe(false);
    menu.update(0.15);
    expect(menu.root.visible).toBe(false);
    menu.open();
    menu.update(0.8);
    expect(menu.interactive).toBe(true);
    menu.dispose();
    expect(menu.root.children).toHaveLength(0);
    menu.dispose();
  });
});
