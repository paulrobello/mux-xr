import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_HOVER,
  linearLuminance,
  resolveAccent,
  resolveAccentHover,
  resolveEnvironmentAccent,
  retintAccentMaterials,
  tagAccentMaterial,
  tintToLuminance,
} from '../src/xr/accent-colors';

describe('accent colors', () => {
  it('keeps every authored cyan for the default accent', () => {
    expect(resolveAccent('')).toBe(DEFAULT_ACCENT);
    expect(resolveAccent('', 0x73d6e6)).toBe(0x73d6e6);
    expect(resolveAccentHover('')).toBe(DEFAULT_ACCENT_HOVER);
    expect(resolveAccent('#ff672f', 0x73d6e6)).toBe(0xff672f);
    expect(resolveAccentHover('#ff672f')).not.toBe(0xff672f);
  });

  it('tints to the authored luminance and restores the authored color without an accent', () => {
    const authored = new THREE.Color(0.035, 0.14, 0.17);
    const tinted = tintToLuminance(new THREE.Color(), authored, new THREE.Color('#ff672f'));
    expect(linearLuminance(tinted)).toBeCloseTo(linearLuminance(authored), 6);
    expect(tinted.r).toBeGreaterThan(tinted.b);
    expect(tintToLuminance(new THREE.Color(), authored, null).equals(authored)).toBe(true);
  });

  it('retints only materials showing the previous accent and restores each original', () => {
    const root = new THREE.Group();
    const plain = new THREE.MeshBasicMaterial({ color: DEFAULT_ACCENT });
    const clock = tagAccentMaterial(new THREE.MeshStandardMaterial({ color: 0x73d6e6 }), 0x73d6e6);
    const glow = new THREE.MeshStandardMaterial({ color: 0x101820, emissive: DEFAULT_ACCENT });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const material of [plain, clock, glow, white])
      root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    retintAccentMaterials(root, '', '#8b5cf6');
    expect(plain.color.getHex()).toBe(0x8b5cf6);
    expect(clock.color.getHex()).toBe(0x8b5cf6);
    expect(glow.emissive.getHex()).toBe(0x8b5cf6);
    expect(glow.color.getHex()).toBe(0x101820);
    expect(white.color.getHex()).toBe(0xffffff);
    retintAccentMaterials(root, '#8b5cf6', '');
    expect(plain.color.getHex()).toBe(DEFAULT_ACCENT);
    expect(clock.color.getHex()).toBe(0x73d6e6);
    expect(glow.emissive.getHex()).toBe(DEFAULT_ACCENT);
  });

  it('resolves the environment accent from its own color, then the interface accent', () => {
    expect(resolveEnvironmentAccent({ accentColor: '', environmentAccentColor: '' })).toBe('');
    expect(resolveEnvironmentAccent({ accentColor: '#ff672f', environmentAccentColor: '' })).toBe(
      '#ff672f',
    );
    expect(
      resolveEnvironmentAccent({ accentColor: '#ff672f', environmentAccentColor: '#22a55a' }),
    ).toBe('#22a55a');
  });
});
