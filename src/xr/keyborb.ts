import * as THREE from 'three';
import { BatchedText, Text, type TroikaTextMaterial } from 'troika-three-text';
import { createScalableLabel } from './labels';

const SHELL_VERTEX = `
  #ifdef KEYBORB_INSTANCED
    attribute vec3 instanceTint;
    attribute float instancePressed;
    varying vec3 shellTint;
    varying float shellPressed;
  #endif
  varying vec3 surfaceNormal;
  varying vec3 viewDirection;
  void main() {
    #ifdef KEYBORB_INSTANCED
      vec4 local = instanceMatrix * vec4(position, 1.0);
      vec3 localNormal = mat3(instanceMatrix) * normal;
      shellTint = instanceTint;
      shellPressed = instancePressed;
    #else
      vec4 local = vec4(position, 1.0);
      vec3 localNormal = normal;
    #endif
    vec4 viewPosition = modelViewMatrix * local;
    surfaceNormal = normalize(normalMatrix * localNormal);
    viewDirection = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SHELL_FRAGMENT = `
  #ifdef KEYBORB_INSTANCED
    varying vec3 shellTint;
    varying float shellPressed;
  #else
    uniform vec3 tint;
    uniform float pressed;
  #endif
  varying vec3 surfaceNormal;
  varying vec3 viewDirection;
  void main() {
    #ifdef KEYBORB_INSTANCED
      vec3 tintColor = shellTint;
      float pressAmount = shellPressed;
    #else
      vec3 tintColor = tint;
      float pressAmount = pressed;
    #endif
    vec3 n = normalize(surfaceNormal);
    vec3 view = normalize(viewDirection);
    vec3 light = normalize(vec3(-0.5, 0.8, 1.0));
    float rim = pow(1.0 - abs(dot(n, view)), 2.6);
    float shine = pow(max(dot(reflect(-light, n), view), 0.0), 32.0);
    vec3 shell = mix(vec3(0.04, 0.12, 0.19), vec3(0.32, 0.72, 0.84), rim);
    shell = shell * tintColor + vec3(shine * 0.65);
    vec3 confirmation = mix(vec3(0.05, 0.55, 0.19), vec3(0.36, 0.95, 0.62), rim);
    shell = mix(shell, confirmation + vec3(shine * 0.3), pressAmount);
    gl_FragColor = vec4(shell, mix(0.18 + rim * 0.56 + shine * 0.2, 0.88, pressAmount));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * One orb key. `labelWidth` lets a word wider than the orb overflow its sides at a readable size;
 * the orb itself keeps the shared diameter the instanced shells and pinch picking rely on.
 */
export function createKeyborbKey(
  label: string,
  diameter: number,
  labelWidth = diameter * 0.92,
): THREE.Mesh {
  const color = new THREE.Color(0xffffff);
  const material = Object.assign(
    new THREE.ShaderMaterial({
      uniforms: { tint: { value: color }, pressed: { value: 0 } },
      transparent: true,
      depthWrite: false,
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
    }),
    { color },
  );
  const root = new THREE.Mesh(new THREE.SphereGeometry(diameter / 2, 24, 16), material);
  const text = createScalableLabel(label, labelWidth, diameter * 0.8, {
    backplate: false,
  });
  text.raycast = () => undefined;
  text.traverse((child) => {
    child.renderOrder = 12;
  });
  root.add(text);
  root.renderOrder = 10;
  Object.assign(root.userData, {
    keyborb: true,
    keyborbLabel: text,
    labelText: label,
    labelWidth: diameter,
    labelHeight: diameter,
  });
  return root;
}

export function setKeyborbPressed(orb: THREE.Mesh, amount: number): void {
  if (orb.material instanceof THREE.ShaderMaterial) orb.material.uniforms.pressed.value = amount;
}

export interface KeyborbShells {
  mesh: THREE.InstancedMesh;
  /** Copies each orb's transform, tint and press state into its instance. */
  update(): void;
}

/**
 * Draws every orb shell of one keyboard in a single instanced call. The orb meshes stay in the
 * scene as invisible hit and state proxies, so picking, lift and press code is unchanged. The
 * orbs must be direct children of the shells' parent and share one diameter.
 */
export function createKeyborbShells(orbs: readonly THREE.Mesh[]): KeyborbShells {
  const diameter = Number(orbs[0]?.userData.labelWidth ?? 0.1);
  const geometry = new THREE.SphereGeometry(diameter / 2, 24, 16);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(orbs.length * 3), 3);
  const presses = new THREE.InstancedBufferAttribute(new Float32Array(orbs.length), 1);
  tints.setUsage(THREE.DynamicDrawUsage);
  presses.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceTint', tints);
  geometry.setAttribute('instancePressed', presses);
  const material = new THREE.ShaderMaterial({
    defines: { KEYBORB_INSTANCED: '' },
    transparent: true,
    depthWrite: false,
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, orbs.length);
  mesh.name = 'keyborb-shells';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  for (const orb of orbs) (orb.material as THREE.Material).visible = false;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const update = (): void => {
    let moved = false;
    let shaded = false;
    const matrices = mesh.instanceMatrix.array;
    orbs.forEach((orb, index) => {
      if (orb.matrixAutoUpdate) orb.updateMatrix();
      const elements = (orb.visible ? orb.matrix : hidden).elements;
      for (let i = 0; i < 16; i++) {
        const value = Math.fround(elements[i]);
        if (matrices[index * 16 + i] !== value) {
          matrices[index * 16 + i] = value;
          moved = true;
        }
      }
      const uniforms = (orb.material as THREE.ShaderMaterial).uniforms;
      const tint = uniforms.tint.value as THREE.Color;
      const pressed = Math.fround(Number(uniforms.pressed.value));
      if (
        tints.getX(index) !== Math.fround(tint.r) ||
        tints.getY(index) !== Math.fround(tint.g) ||
        tints.getZ(index) !== Math.fround(tint.b) ||
        presses.getX(index) !== pressed
      ) {
        tints.setXYZ(index, tint.r, tint.g, tint.b);
        presses.setX(index, pressed);
        shaded = true;
      }
    });
    if (moved) mesh.instanceMatrix.needsUpdate = true;
    if (shaded) {
      tints.needsUpdate = true;
      presses.needsUpdate = true;
    }
  };
  update();
  return { mesh, update };
}

/**
 * A troika batch that rebuilds its per-glyph data only after a glyph moved or the batch repacked.
 * Stock BatchedText rebuilds it on every render, twice a frame in XR, and because it compares
 * float64 values with its float32 store it re-uploads the data texture each time.
 * Member colour, opacity, stroke, outline, clip and curve go only into that data, never through a
 * sync, so code that changes them on a member must bump `revision`.
 */
export class KeyborbGlyphBatch extends BatchedText {
  /** Bumped whenever member data must be rebuilt. */
  revision = 0;
  private readonly prepared = new WeakMap<TroikaTextMaterial, number>();
  private boundsRevision = -1;

  constructor() {
    super();
    this.addEventListener('synccomplete', () => {
      this.revision++;
    });
  }

  override updateBounds(): void {
    if (this.boundsRevision === this.revision) return;
    this.boundsRevision = this.revision;
    super.updateBounds();
  }

  override _prepareForRender(material: TroikaTextMaterial): void {
    const texture = this._dataTextures[material.isTextOutlineMaterial ? 'outline' : 'main'];
    if (texture && this.prepared.get(material) === this.revision) {
      // The outline material shares the main material's uniforms, so the flag is set per pass.
      material.uniforms.uTroikaIsOutline.value = Boolean(material.isTextOutlineMaterial);
      material.setMatrixTexture(texture);
      Text.prototype._prepareForRender.call(this, material);
      return;
    }
    super._prepareForRender(material);
    this.prepared.set(material, this.revision);
  }
}

export interface KeyborbGlyphs {
  batch: KeyborbGlyphBatch;
  /** Places each glyph where its orb label sits, so lift and press motion carry it along. */
  update(): void;
}

/**
 * Draws every orb glyph of one keyboard in one troika batch. Each label keeps its Text, which
 * still re-lays out on label changes, but the Text renders through the batch instead of alone.
 * The orbs must be direct children of the batch's parent.
 */
export function createKeyborbGlyphs(orbs: readonly THREE.Mesh[]): KeyborbGlyphs {
  const batch = new KeyborbGlyphBatch();
  batch.name = 'keyborb-glyphs';
  batch.renderOrder = 12;
  batch.depthOffset = -1;
  batch.frustumCulled = false;
  batch.raycast = () => undefined;
  const members: Array<{ orb: THREE.Mesh; label: THREE.Object3D; text: Text }> = [];
  for (const orb of orbs) {
    const label = orb.userData.keyborbLabel as THREE.Object3D | undefined;
    const text = label?.userData.labelTextObject as Text | undefined;
    if (!label || !text) continue;
    label.remove(text);
    text.matrixAutoUpdate = false;
    batch.addText(text);
    members.push({ orb, label, text });
  }
  const local = new THREE.Matrix4();
  const next = new THREE.Matrix4();
  const update = (): void => {
    let moved = false;
    for (const { orb, label, text } of members) {
      if (orb.matrixAutoUpdate) orb.updateMatrix();
      if (label.matrixAutoUpdate) label.updateMatrix();
      if (!orb.visible || !label.visible) next.makeScale(0, 0, 0);
      else {
        local.compose(text.position, text.quaternion, text.scale);
        next.multiplyMatrices(orb.matrix, label.matrix).multiply(local);
      }
      const elements = text.matrix.elements;
      for (let i = 0; i < 16; i++) {
        // The batch stores float32, so compare and keep the rounded values.
        const value = Math.fround(next.elements[i]);
        if (elements[i] === value) continue;
        elements[i] = value;
        moved = true;
      }
    }
    if (moved) batch.revision++;
  };
  update();
  return { batch, update };
}
