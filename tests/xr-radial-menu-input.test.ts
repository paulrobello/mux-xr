import { createXrRadialMenu } from '@par/xr-workspace';
import * as THREE from 'three';
import { expect, test, vi } from 'vitest';

vi.mock('../packages/xr-workspace/src/labels', () => import('./helpers/labels'));

test('either controller can confirm its pressed ray target on a stick-opened menu', () => {
  const scene = new THREE.Scene();
  const dispatch = vi.fn();
  const menu = createXrRadialMenu(scene, dispatch);
  const items = [
    { id: 'alpha', label: 'Alpha' },
    { id: 'beta', label: 'Beta' },
  ];
  function controller(handedness: XRHandedness) {
    const stick = { pressed: false };
    const source = {
      handedness,
      gripSpace: {},
      targetRaySpace: {},
      gamepad: { buttons: [{}, {}, {}, stick], axes: [0, 0, 0, 0] },
    } as unknown as XRInputSource;
    return { stick, source, position: new THREE.Vector3(2, 0, 0) };
  }
  const opener = controller('left'),
    pointer = controller('right');
  const orientation = new THREE.Quaternion();
  const frame = {
    session: { inputSources: [opener.source, pointer.source] },
    getViewerPose: () => ({ transform: { position: new THREE.Vector3(), orientation } }),
    getPose: (space: XRSpace) => ({
      transform: {
        orientation,
        position: space === pointer.source.targetRaySpace ? pointer.position : opener.position,
      },
    }),
  } as unknown as XRFrame;
  const ref = {} as XRReferenceSpace;
  let time = 0;
  function tick() {
    time += 1 / 60;
    menu.update(frame, ref, time, items, false);
  }
  for (const hand of [pointer, opener]) {
    tick();
    opener.stick.pressed = true;
    tick();
    opener.stick.pressed = false;
    for (let i = 0; i < 48; i++) tick();
    const wedge = scene.getObjectByName('radial-menu-alpha');
    if (!wedge) throw Error('Missing shared menu wedge');
    wedge.getWorldPosition(hand.position).z += 0.2;
    tick();
    menu.handleSelectStart(hand.source);
    hand.position.x += 2;
    tick();
    expect(dispatch).not.toHaveBeenCalled();
    expect(menu.handleSelect(hand.source)).toBe(true);
    expect(dispatch.mock.calls).toEqual([['alpha']]);
    expect(menu.handleSelect(hand.source)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    menu.reset();
    dispatch.mockClear();
  }
  expect(menu.isModal).toBe(false);
  expect(menu.handleSelect(opener.source)).toBe(false);
  menu.dispose();
  expect(scene.children).toHaveLength(0);
});
