import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_FILTERING } from '../src/terminal/filtering';
import { createTerminalMaterial, setTerminalMaterialFiltering } from '../src/xr/terminal-material';

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
});
