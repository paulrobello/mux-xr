import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_FILTERING } from '../src/terminal/filtering';
import {
  createTerminalMaterial,
  setTerminalBackgroundOpacity,
  setTerminalMaterialFiltering,
} from '../src/xr/terminal-material';

describe('terminal material filtering', () => {
  it('toggles base-level sampling only for gaze clarity on mipmap modes', () => {
    const material = createTerminalMaterial(new THREE.DataTexture());
    const uniform = material.userData.terminalGazePriority as { value: number };
    expect(uniform.value).toBe(0);
    for (const mode of ['nearest', 'linear', 'mipmap-nearest', 'mipmap-linear'] as const) {
      setTerminalMaterialFiltering(material, { ...DEFAULT_TERMINAL_FILTERING, mode }, true);
      expect(uniform.value).toBe(mode.startsWith('mipmap-') ? 1 : 0);
    }
    setTerminalMaterialFiltering(
      material,
      { ...DEFAULT_TERMINAL_FILTERING, gazeClarity: false },
      true,
    );
    expect(uniform.value).toBe(0);
    setTerminalMaterialFiltering(material, DEFAULT_TERMINAL_FILTERING, false);
    expect(uniform.value).toBe(0);
    material.dispose();
  });

  it('changes only the material uniform, not the texture sampler or versions', () => {
    const texture = new THREE.DataTexture();
    const material = createTerminalMaterial(texture);
    const textureVersion = texture.version;
    const materialVersion = material.version;
    const minFilter = texture.minFilter;
    const magFilter = texture.magFilter;
    setTerminalMaterialFiltering(material, DEFAULT_TERMINAL_FILTERING, true);
    setTerminalMaterialFiltering(
      material,
      { ...DEFAULT_TERMINAL_FILTERING, mode: 'nearest' },
      true,
    );
    expect(texture.minFilter).toBe(minFilter);
    expect(texture.magFilter).toBe(magFilter);
    expect(texture.version).toBe(textureVersion);
    expect(material.version).toBe(materialVersion);
    material.dispose();
  });

  it('preserves map color-space shader code while adding textureLod base sampling', () => {
    const material = createTerminalMaterial(new THREE.DataTexture());
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: '#include <map_fragment>\n#include <colorspace_fragment>',
      vertexShader: '',
    };
    material.onBeforeCompile(
      shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
      {} as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.terminalGazePriority).toBe(material.userData.terminalGazePriority);
    expect(shader.fragmentShader).toContain('textureLod( map, vMapUv, 0.0 )');
    expect(shader.fragmentShader).toContain('sRGBTransferEOTF');
    expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
    material.dispose();
  });

  it('applies opacity only to dark sampled background pixels', () => {
    const material = createTerminalMaterial(new THREE.DataTexture());
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: '#include <map_fragment>\n#include <colorspace_fragment>',
      vertexShader: '',
    };
    material.onBeforeCompile(
      shader as unknown as Parameters<typeof material.onBeforeCompile>[0],
      {} as THREE.WebGLRenderer,
    );
    expect(shader.uniforms.terminalBackgroundOpacity).toBe(
      material.userData.terminalBackgroundOpacity,
    );
    expect(shader.fragmentShader).toContain(
      'max( max( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b )',
    );
    expect(shader.fragmentShader).toContain(
      'smoothstep( 0.005, 0.025, terminalDarkBackgroundValue )',
    );
    expect(shader.fragmentShader).toContain('#ifdef USE_MAP');
    expect(shader.fragmentShader).toContain(
      'diffuseColor.a *= mix( 1.0, terminalBackgroundOpacity',
    );
    expect(shader.fragmentShader).toContain('#include <colorspace_fragment>');
    material.dispose();
  });

  it('uses peak RGB so saturated glyph colors stay opaque', () => {
    const darkBackgroundMask = (red: number, green: number, blue: number): number => {
      const peak = Math.max(red, green, blue);
      const t = Math.max(0, Math.min(1, (peak - 0.005) / 0.02));
      return 1 - t * t * (3 - 2 * t);
    };
    expect(darkBackgroundMask(0, 0, 0)).toBe(1);
    expect(darkBackgroundMask(0, 0, 0.01)).toBeCloseTo(0.84375);
    expect(darkBackgroundMask(0, 0, 0.4)).toBe(0);
    expect(darkBackgroundMask(0.2, 0.2, 0.2)).toBe(0);
    expect(darkBackgroundMask(0.1, 0.8, 0.1)).toBe(0);
    expect(darkBackgroundMask(0, 0, 0.002)).toBeCloseTo(1);
  });

  it('changes transparency state only when crossing opaque mode', () => {
    const material = createTerminalMaterial(new THREE.DataTexture());
    setTerminalBackgroundOpacity(material, 0.5);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect((material.userData.terminalBackgroundOpacity as { value: number }).value).toBe(0.5);
    const nonOpaqueMaterialVersion = material.version;
    setTerminalBackgroundOpacity(material, 0.4);
    expect(material.version).toBe(nonOpaqueMaterialVersion);
    setTerminalBackgroundOpacity(material, 1);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.version).toBeGreaterThan(nonOpaqueMaterialVersion);
    material.dispose();
  });
});
