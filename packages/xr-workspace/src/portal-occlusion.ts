import * as THREE from 'three';

export type PortalOpening = { mouth: THREE.Object3D; radius: number };

/** Hide a local surface behind a circular portal from each eye. A mouth's local +Z faces the viewer. */
export class PortalOcclusion {
  private readonly disks: THREE.Vector4[];
  private readonly normals: THREE.Vector3[];
  private readonly count = { value: 0 };
  private readonly materials = new WeakMap<THREE.Material, THREE.Material>();
  private readonly owned = new Set<THREE.Material>();

  constructor(capacity = 4) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError('Expected a positive portal capacity');
    this.disks = Array.from({ length: capacity }, () => new THREE.Vector4());
    this.normals = Array.from({ length: capacity }, () => new THREE.Vector3());
  }

  update(openings: readonly PortalOpening[]): void {
    if (openings.length > this.disks.length)
      throw new RangeError('Portal count exceeds shader capacity');
    let count = 0;
    for (const { mouth, radius } of openings) {
      if (!mouth.visible) continue;
      mouth.updateWorldMatrix(true, false);
      const m = mouth.matrixWorld.elements;
      this.normals[count].set(m[8], m[9], m[10]).normalize();
      this.disks[count++].set(m[12], m[13], m[14], radius * Math.hypot(m[0], m[1], m[2]));
    }
    this.count.value = count;
  }

  material(original: THREE.Material): THREE.Material {
    const cached = this.materials.get(original);
    if (cached) return cached;
    const copy = original.clone();
    copy.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile.call(copy, shader, renderer);
      shader.uniforms.occlusionDiskCount = this.count;
      shader.uniforms.occlusionDisks = { value: this.disks };
      shader.uniforms.occlusionNormals = { value: this.normals };
      shader.vertexShader = `#define USE_PORTAL_OCCLUSION
        varying vec3 portalOcclusionWorldPosition;
        ${shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          portalOcclusionWorldPosition = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;`,
        )}`;
      shader.fragmentShader = `varying vec3 portalOcclusionWorldPosition;
        uniform int occlusionDiskCount;
        uniform vec4 occlusionDisks[${this.disks.length}];
        uniform vec3 occlusionNormals[${this.disks.length}];
        ${shader.fragmentShader.replace(
          /void main\s*\(\s*\)\s*\{/,
          `void main() {
          for(int i=0;i<${this.disks.length};i++) {
            if(i>=occlusionDiskCount) break;
            vec3 eye=cameraPosition-occlusionDisks[i].xyz;
            vec3 point=portalOcclusionWorldPosition-occlusionDisks[i].xyz;
            float front=dot(eye,occlusionNormals[i]), back=dot(point,occlusionNormals[i]);
            if(front>0. && back<0.) {
              vec3 hit=mix(eye,point,front/(front-back));
              if(dot(hit,hit)<occlusionDisks[i].w*occlusionDisks[i].w) discard;
            }
          }`,
        )}`;
    };
    copy.customProgramCacheKey = () =>
      `${original.customProgramCacheKey()}:portal-occlusion-${this.disks.length}`;
    this.owned.add(copy);
    this.materials.set(original, copy);
    this.materials.set(copy, copy);
    return copy;
  }

  mask(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        node.material = Array.isArray(node.material)
          ? node.material.map((material) => this.material(material))
          : this.material(node.material);
      }
    });
  }
  /** Release owned material variants after their geometry leaves the scene. */
  dispose(): void {
    for (const material of this.owned) material.dispose();
    this.owned.clear();
  }
}
