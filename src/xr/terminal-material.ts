import * as THREE from 'three';
import type { TerminalFiltering } from '../terminal/filtering';

export function createTerminalMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const priority = { value: 0 };
  material.userData.terminalGazePriority = priority;
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.terminalGazePriority = priority;
    shader.fragmentShader = `uniform float terminalGazePriority;\n${shader.fragmentShader}`.replace(
      '#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace(
        'texture2D( map, vMapUv )',
        '( terminalGazePriority > 0.5 ? textureLod( map, vMapUv, 0.0 ) : texture2D( map, vMapUv ) )',
      ),
    );
  };
  material.customProgramCacheKey = (): string => 'terminal-gaze-base-level-v1';
  return material;
}

export function setTerminalMaterialFiltering(
  material: THREE.MeshBasicMaterial,
  filtering: TerminalFiltering,
  gazePriority: boolean,
): void {
  const uniform = material.userData.terminalGazePriority as { value: number };
  uniform.value =
    gazePriority && filtering.gazeClarity && filtering.mode.startsWith('mipmap-') ? 1 : 0;
}
