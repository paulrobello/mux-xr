import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('troika-three-text')>();
  return {
    ...actual,
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
  };
});

import { createRadialMenu as createWorkspaceRadialMenu, findControl } from '@par/xr-workspace';
import { createRadialMenu, type RadialMenuAction } from '../src/xr/radial-menu';

function actionNodes(menu: ReturnType<typeof createRadialMenu>): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  menu.root.traverse((object) => {
    if (object.userData.radialAction) nodes.push(object);
  });
  return nodes;
}

describe('animated radial menu', () => {
  it('animates from center to a clockwise, upright eight-action fan', () => {
    const menu = createRadialMenu();
    menu.root.scale.setScalar(0.8);
    menu.open();
    menu.update(0.128);
    expect(menu.interactive).toBe(false);
    const targets = actionNodes(menu).filter(
      (child) => child.userData.radialAction !== 'cancel' && child.name.startsWith('radial-menu-'),
    );
    expect(new Set(targets.map((target) => target.userData.radialAction))).toEqual(
      new Set(['keyboard', 'commands', 'panes', 'layout', 'warp', 'widgets', 'settings', 'focus']),
    );
    expect(targets.every((target) => target.position.length() < 0.01)).toBe(true);
    menu.update(0.128);
    expect(targets.every((target) => target.position.y < -0.2)).toBe(true);
    const stackDistance = targets[0].position.length();
    menu.update(0.384);
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

  it('gives sectors, the cancel disc and the footer a findable control id', () => {
    const menu = createRadialMenu();
    for (const name of [
      'radial-menu-keyboard',
      'radial-menu-cancel',
      'radial-menu-reload-update',
    ]) {
      const control = findControl(menu.root, name);
      expect(control?.name).toBe(name);
      expect(control?.userData.controlId).toBe(name);
    }
    expect(findControl(menu.root, 'radial-menu-keyboard')).toBe(
      menu.root.getObjectByName('radial-menu-keyboard'),
    );
    menu.dispose();
  });

  it('propagates pick metadata and handles close and repeated open without leaks', () => {
    const menu = createRadialMenu();
    const reload = menu.root.getObjectByName('radial-menu-reload-update');
    expect(reload?.visible).toBe(false);
    menu.setUpdateAvailable(true);
    expect(reload?.visible).toBe(true);
    menu.setUpdateAvailable(false);
    expect(reload?.visible).toBe(false);
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
    expect(actions).toContain('panes');
    expect(actions).toContain('layout');
    expect(actions).toContain('settings');
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

  it('outlines every sector and the cancel disc without catching rays, fading with the menu', () => {
    const menu = createRadialMenu();
    const outlines: THREE.Mesh[] = [];
    menu.root.traverse((object) => {
      if (object.name === 'radial-outline') outlines.push(object as THREE.Mesh);
    });
    expect(outlines.map((outline) => outline.parent?.name).sort()).toEqual(
      [
        'radial-menu-cancel',
        ...['keyboard', 'commands', 'panes', 'layout', 'warp', 'widgets', 'settings', 'focus'].map(
          (action) => `radial-menu-${action}`,
        ),
      ].sort(),
    );
    const material = outlines[0].material as THREE.MeshBasicMaterial;
    expect(outlines.every((outline) => outline.material === material)).toBe(true);
    menu.open();
    menu.update(0.8);
    menu.root.updateMatrixWorld(true);
    for (const outline of outlines) {
      const position = outline.geometry.getAttribute('position') as THREE.BufferAttribute;
      const onRibbon = new THREE.Vector3()
        .add(new THREE.Vector3().fromBufferAttribute(position, 0))
        .add(new THREE.Vector3().fromBufferAttribute(position, 1))
        .add(new THREE.Vector3().fromBufferAttribute(position, 2))
        .divideScalar(3);
      outline.localToWorld(onRibbon);
      const ray = new THREE.Raycaster(
        onRibbon.clone().add(new THREE.Vector3(0, 0, 1)),
        new THREE.Vector3(0, 0, -1),
      );
      const hits: THREE.Intersection[] = [];
      outline.raycast(ray, hits);
      expect(hits).toHaveLength(0);
      THREE.Mesh.prototype.raycast.call(outline, ray, hits);
      expect(hits.length).toBeGreaterThan(0);
    }
    const disc = outlines.find((outline) => outline.parent?.name === 'radial-menu-cancel');
    const box = new THREE.Box3().setFromBufferAttribute(
      disc?.geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    expect(box.max.x).toBeCloseTo(0.1075, 3);
    expect(box.min.y).toBeCloseTo(-0.1075, 3);
    const openOpacity = material.opacity;
    expect(openOpacity).toBeGreaterThan(0.8);
    menu.close();
    menu.update(0.075);
    expect(material.opacity).toBeLessThan(openOpacity);
    menu.dispose();
  });

  it('reaches interactive state after the shortened opening duration', () => {
    const menu = createRadialMenu();
    menu.open();
    menu.update(0.63);
    expect(menu.interactive).toBe(false);
    menu.update(0.01);
    expect(menu.interactive).toBe(true);
    menu.dispose();
  });
  it('applies a custom palette to fills, true Troika text, footer, and center label', () => {
    const menu = createWorkspaceRadialMenu({
      items: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      centerLabel: 'Back',
      theme: {
        glass: '#112233',
        selected: '#334455',
        cancel: '#556677',
        text: '#f0c000',
        outline: '#00aaff',
      },
      footer: { id: 'footer', label: 'Footer' },
    });
    const sector = menu.root.getObjectByName('radial-menu-one') as THREE.Group;
    const sectorFill = sector.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const center = menu.root.getObjectByName('radial-menu-cancel') as THREE.Group;
    const centerFill = center.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const sectorLabel = sector.children.find((child) => child.userData.labelText) as THREE.Object3D;
    const centerLabel = center.children.find((child) => child.userData.labelText) as THREE.Object3D;
    const textColor = (label: THREE.Object3D): number =>
      (label.userData.labelTextObject as { color: number | string | THREE.Color }).color instanceof
      THREE.Color
        ? (label.userData.labelTextObject as { color: THREE.Color }).color.getHex()
        : new THREE.Color(
            (label.userData.labelTextObject as { color: number | string }).color,
          ).getHex();

    expect((sectorFill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('112233');
    expect((centerFill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('556677');
    expect(textColor(sectorLabel)).toBe(0xf0c000);
    expect(textColor(centerLabel)).toBe(0xf0c000);
    const footer = menu.root.getObjectByName('radial-menu-footer') as THREE.Mesh;
    expect((footer.material as THREE.MeshBasicMaterial).map).not.toBeNull();
    expect(textColor(footer)).toBe(0xf0c000);
    const outline = sector.children.find((child) => child.name === 'radial-outline') as THREE.Mesh;
    expect((outline.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('00aaff');

    menu.open();
    menu.update(0.8);
    menu.setHovered('one');
    expect((sectorFill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('334455');
    menu.setHovered(null);
    expect((sectorFill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('112233');
    menu.setAccent('#ff0000');
    expect((outline.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ff0000');
    menu.setAccent('');
    expect((outline.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('00aaff');
    menu.dispose();
  });

  it('rejects malformed theme colors', () => {
    expect(() =>
      createWorkspaceRadialMenu({
        items: [
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ],
        theme: { text: 'red' },
      }),
    ).toThrow('must be a #rrggbb string');
  });

  it('keeps the authored palette when theme is omitted or null', () => {
    for (const theme of [undefined, null]) {
      const menu = createWorkspaceRadialMenu({
        items: [
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ],
        theme,
      });
      const sector = menu.root.getObjectByName('radial-menu-one') as THREE.Group;
      const label = sector.children.find((child) => child.userData.labelTextObject);
      expect(label?.userData.labelTextObject.color).toBe(0xffffff);
      const fill = sector.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      expect((fill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('101c27');
      menu.open();
      menu.update(0.8);
      menu.setHovered('one');
      expect((fill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('315c6d');
      menu.setHovered('cancel');
      expect((fill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('101c27');
      menu.dispose();
    }
  });
});
