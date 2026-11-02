import * as THREE from 'three';
import type { TerminalFiltering } from '../terminal/filtering';

const TERMINAL_BACKGROUND_OPACITY_MIN = 0.1;

function clampTerminalBackgroundOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(TERMINAL_BACKGROUND_OPACITY_MIN, Math.min(1, value));
}

export function createTerminalMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const priority = { value: 0 };
  const backgroundOpacity = { value: 1 };
  material.userData.terminalGazePriority = priority;
  material.userData.terminalBackgroundOpacity = backgroundOpacity;
  material.userData.terminalBackgroundOpacityTransparent = false;
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.terminalGazePriority = priority;
    shader.uniforms.terminalBackgroundOpacity = backgroundOpacity;
    shader.fragmentShader =
      `uniform float terminalGazePriority;\nuniform float terminalBackgroundOpacity;\n${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        THREE.ShaderChunk.map_fragment.replace(
          'texture2D( map, vMapUv )',
          '( terminalGazePriority > 0.5 ? textureLod( map, vMapUv, 0.0 ) : texture2D( map, vMapUv ) )',
        ) +
          '\n#ifdef USE_MAP\n' +
          '\tfloat terminalDarkBackgroundValue = max( max( sampledDiffuseColor.r, sampledDiffuseColor.g ), sampledDiffuseColor.b );\n' +
          '\tfloat terminalDarkBackgroundMask = 1.0 - smoothstep( 0.005, 0.025, terminalDarkBackgroundValue );\n' +
          '\tdiffuseColor.a *= mix( 1.0, terminalBackgroundOpacity, terminalDarkBackgroundMask );\n' +
          '#endif',
      );
  };
  material.customProgramCacheKey = (): string => 'terminal-gaze-base-level-background-opacity-v1';
  return material;
}

export function setTerminalBackgroundOpacity(
  material: THREE.MeshBasicMaterial,
  opacity: number,
): void {
  const uniform = material.userData.terminalBackgroundOpacity as { value: number };
  const clampedOpacity = clampTerminalBackgroundOpacity(opacity);
  uniform.value = clampedOpacity;

  const transparent = clampedOpacity < 1;
  if (material.userData.terminalBackgroundOpacityTransparent === transparent) return;
  material.userData.terminalBackgroundOpacityTransparent = transparent;
  material.transparent = transparent;
  material.depthWrite = !transparent;
  material.needsUpdate = true;
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
