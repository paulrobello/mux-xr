import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createCartoonHand } from '../packages/xr-workspace/src/cartoon-hand';
import { createStandardHand } from '../packages/xr-workspace/src/standard-hand';

type Side = 'left' | 'right';
const bytes = (side: Side): ArrayBuffer =>
  new Uint8Array(readFileSync(`public/assets/xr-hands/${side}.glb`)).slice().buffer;
const parsedLoader = (): GLTFLoader =>
  ({
    loadAsync: (url: string) =>
      new GLTFLoader().parseAsync(bytes(url.includes('right') ? 'right' : 'left'), ''),
  }) as unknown as GLTFLoader;
const failingLoader = (): GLTFLoader =>
  ({ loadAsync: () => Promise.reject(new Error('offline')) }) as unknown as GLTFLoader;
const material = (root: THREE.Object3D, name: string): THREE.MeshStandardMaterial =>
  (root.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial;
const surface = (target: THREE.MeshStandardMaterial) => ({
  color: target.color.getHex(),
  emissive: target.emissive.getHex(),
  emissiveIntensity: target.emissiveIntensity,
  roughness: target.roughness,
  metalness: target.metalness,
});

const theme = {
  hand: {
    color: '#b87333',
    roughness: 0.42,
    metalness: 0.78,
    emissive: '#241006',
    emissiveIntensity: 0.08,
  },
  sleeve: {
    color: '#2b1014',
    roughness: 0.78,
    metalness: 0.12,
    emissive: '#090304',
    emissiveIntensity: 0.03,
  },
};

describe('hand themes', () => {
  it('keeps the original matte fallback for omitted and null themes and restores it on reset', () => {
    const original = createCartoonHand();
    for (const choice of [undefined, null]) {
      const hand = createCartoonHand({ theme: choice });
      for (const name of ['cartoon-hand-skin', 'elastic-hand-arm']) {
        const baseline = surface(material(original.root, name));
        expect(baseline).toMatchObject({ roughness: 0.85, metalness: 0, emissiveIntensity: 0.6 });
        expect(surface(material(hand.root, name))).toEqual(baseline);
        hand.setTheme(theme);
        hand.setTheme(null);
        expect(surface(material(hand.root, name))).toEqual(baseline);
      }
      hand.dispose();
    }
    original.dispose();
  });

  it('applies a cartoon constructor theme before any update or setColor call', () => {
    const hand = createCartoonHand({ theme });
    expect(surface(material(hand.root, 'cartoon-hand-skin'))).toMatchObject({
      roughness: 0.42,
      metalness: 0.78,
      emissive: new THREE.Color('#241006').getHex(),
      emissiveIntensity: 0.08,
    });
    expect(surface(material(hand.root, 'elastic-hand-arm'))).toMatchObject({
      roughness: 0.78,
      metalness: 0.12,
      emissive: new THREE.Color('#090304').getHex(),
      emissiveIntensity: 0.03,
    });
    hand.dispose();
  });

  it('themes the fallback while standard assets are still loading', async () => {
    let resolve!: (value: never) => void;
    const pending = new Promise<never>((next) => (resolve = next));
    const hand = createStandardHand({
      theme,
      loader: { loadAsync: () => pending } as unknown as GLTFLoader,
    });
    expect(material(hand.root, 'cartoon-hand-skin').metalness).toBe(0.78);
    expect(material(hand.root, 'elastic-hand-arm').roughness).toBe(0.78);
    hand.dispose();
    resolve(undefined as never);
    await hand.assetReady;
  });

  it('themes both loaded wrists and caps, then restores every original surface property', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const originals = {
      sleeve: surface(material(hand.root, 'elastic-hand-arm')),
      sides: Object.fromEntries(
        (['left', 'right'] as const).map((side) => [
          side,
          [
            surface(material(hand.root, `standard-hand-skin-${side}`)),
            surface(material(hand.root, `standard-hand-wrist-cap-${side}`)),
          ],
        ]),
      ),
    };
    hand.setTheme(theme);
    for (const side of ['left', 'right'] as const) {
      expect(material(hand.root, `standard-hand-skin-${side}`).metalness).toBe(0.78);
      expect(material(hand.root, `standard-hand-wrist-cap-${side}`).metalness).toBe(0.78);
    }
    expect(material(hand.root, 'elastic-hand-arm').metalness).toBe(0.12);
    hand.setTheme(null);
    expect(surface(material(hand.root, 'elastic-hand-arm'))).toEqual(originals.sleeve);
    for (const side of ['left', 'right'] as const) {
      const expected = originals.sides[side] as [
        ReturnType<typeof surface>,
        ReturnType<typeof surface>,
      ];
      expect(surface(material(hand.root, `standard-hand-skin-${side}`))).toEqual(expected[0]);
      expect(surface(material(hand.root, `standard-hand-wrist-cap-${side}`))).toEqual(expected[1]);
    }
    hand.dispose();
  });

  it('supports partial themes, fallback loads, color and glow APIs', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const sleeveBefore = surface(material(hand.root, 'elastic-hand-arm'));
    hand.setTheme({ hand: { metalness: 0.25 } });
    expect(material(hand.root, 'standard-hand-wrist-cap-left').metalness).toBe(0.25);
    expect(surface(material(hand.root, 'elastic-hand-arm'))).toEqual(sleeveBefore);
    hand.setColor('#3366ff');
    hand.setArmGlow('#ff0000');
    expect(material(hand.root, 'elastic-hand-arm').emissive.getHex()).toBe(0xff0000);
    hand.setArmGlow(null);
    expect(material(hand.root, 'elastic-hand-arm').color.getHex()).not.toBe(sleeveBefore.color);
    hand.dispose();

    const fallback = createStandardHand({ theme, loader: failingLoader() });
    expect(await fallback.assetReady).toBe(false);
    expect(material(fallback.root, 'cartoon-hand-skin').metalness).toBe(0.78);
    expect(material(fallback.root, 'elastic-hand-arm').metalness).toBe(0.12);
    fallback.dispose();
  });
});
