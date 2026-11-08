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

import { UI_ENV_MAP_INTENSITY } from '../src/xr/ui-environment';
import { createClockWidget } from '../src/xr/widgets';

describe('clock widgets', () => {
  it('creates bounded, identifiable digital widgets with close metadata', () => {
    const widget = createClockWidget('digital-clock');
    expect(widget.root.userData.widgetKind).toBe('digital-clock');
    expect(widget.root.userData.scaleLimits).toEqual([0.25, 2]);
    expect(widget.root.userData.widgetId).toMatch(/^clock-widget-/);
    const close = widget.root.getObjectByName('clock-close');
    expect(close?.userData.inputAction).toBe('closeWidget');
    expect(close?.userData.helpText).toBe('Close this clock widget');
    expect(
      widget.root.children.every(
        (child) => child.userData.widgetId === widget.root.userData.widgetId,
      ),
    ).toBe(true);
    widget.dispose();
  });

  it('rotates analog hands from local time and updates digital text once per second', () => {
    const analog = createClockWidget('analog-clock');
    analog.update(new Date(2026, 0, 1, 3, 15, 0, 0).getTime());
    const minute = analog.root.getObjectByName('clock-minute-hand');
    expect(minute?.rotation.z).toBeCloseTo(-Math.PI / 2);
    analog.dispose();

    const digital = createClockWidget('digital-clock');
    const display = digital.root.getObjectByName('digital-clock-display');
    const firstSecond = new Date(2026, 0, 1, 13, 2, 3, 100).getTime();
    digital.update(firstSecond);
    const sameSecondText = display?.userData.labelText;
    digital.update(firstSecond + 800);
    expect(display?.userData.labelText).toBe(sameSecondText);
    digital.update(firstSecond + 1000);
    expect(display?.userData.labelText).toContain('1:02:04 PM');
    digital.dispose();
  });

  it.each(['digital-clock', 'analog-clock'] as const)(
    'lights every %s body material with the shared env map and never disposes it',
    (kind) => {
      const envMap = new THREE.Texture();
      envMap.userData.sharedUIEnvironment = true;
      const environmentDispose = vi.fn();
      envMap.addEventListener('dispose', environmentDispose);
      const widget = createClockWidget(kind, envMap);
      const standard = new Set<THREE.MeshStandardMaterial>();
      widget.root.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (material instanceof THREE.MeshStandardMaterial) standard.add(material);
      });
      expect(standard.size).toBeGreaterThanOrEqual(kind === 'digital-clock' ? 2 : 5);
      for (const material of standard) {
        expect(material.envMap).toBe(envMap);
        expect(material.envMapIntensity).toBe(UI_ENV_MAP_INTENSITY);
        expect(material.roughness).toBeGreaterThanOrEqual(0.6);
      }
      widget.dispose();
      expect(environmentDispose).not.toHaveBeenCalled();
    },
  );
});
