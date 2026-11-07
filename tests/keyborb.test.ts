import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/xr/labels', () => ({
  createScalableLabel: (label: string, width: number, height: number) => {
    const root = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial(),
    );
    root.material.visible = false;
    const text = new THREE.Mesh(new THREE.PlaneGeometry(width, height));
    text.geometry.computeBoundingBox();
    text.position.z = 0.001;
    text.scale.setScalar(0.5);
    root.add(text);
    Object.assign(root.userData, { labelText: label, labelTextObject: text });
    return root;
  },
}));

const { createKeyborbGlyphs, createKeyborbKey, createKeyborbShells, setKeyborbPressed } =
  await import('../src/xr/keyborb');
const { curveKeyboardContent } = await import('../src/xr/keyboard-surface');

function keyboard(): { root: THREE.Group; orbs: THREE.Mesh[] } {
  const root = new THREE.Group();
  const orbs = ['a', 'b', 'c'].map((label, index) => {
    const orb = createKeyborbKey(label, 0.1);
    orb.position.set(index * 0.13, 0, 0.05);
    root.add(orb);
    return orb;
  });
  return { root, orbs };
}

describe('Keyborb batching', () => {
  it('draws every shell in one instanced call that tracks orb state', () => {
    const { root, orbs } = keyboard();
    const shells = createKeyborbShells(orbs);
    root.add(shells.mesh);
    expect(shells.mesh.count).toBe(3);
    expect(orbs.every((orb) => !(orb.material as THREE.Material).visible)).toBe(true);
    orbs[1].position.y = 0.02;
    orbs[1].visible = true;
    orbs[2].visible = false;
    setKeyborbPressed(orbs[1], 1);
    (orbs[1].material as THREE.ShaderMaterial & { color: THREE.Color }).color.setHex(0xff0000);
    const version = shells.mesh.instanceMatrix.version;
    shells.update();
    const matrix = new THREE.Matrix4();
    shells.mesh.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual(
      orbs[1].position.toArray().map(Math.fround),
    );
    shells.mesh.getMatrixAt(2, matrix);
    expect(matrix.determinant()).toBe(0);
    const geometry = shells.mesh.geometry;
    expect(geometry.getAttribute('instancePressed').getX(1)).toBe(1);
    expect(geometry.getAttribute('instanceTint').getX(1)).toBe(1);
    expect(geometry.getAttribute('instanceTint').getY(1)).toBe(0);
    expect(shells.mesh.instanceMatrix.version).toBeGreaterThan(version);
    const settled = shells.mesh.instanceMatrix.version;
    shells.update();
    expect(shells.mesh.instanceMatrix.version).toBe(settled);
  });

  it('moves every glyph into one batch that carries it with its orb', () => {
    const { root, orbs } = keyboard();
    const glyphs = createKeyborbGlyphs(orbs);
    root.add(glyphs.batch);
    const labels = orbs.map((orb) => orb.userData.keyborbLabel as THREE.Object3D);
    const texts = labels.map((label) => label.userData.labelTextObject as THREE.Mesh);
    for (const [index, label] of labels.entries()) {
      expect(label.children).not.toContain(texts[index]);
      expect(texts[index].matrixAutoUpdate).toBe(false);
    }
    orbs[0].position.y = 0.03;
    glyphs.update();
    const position = new THREE.Vector3().setFromMatrixPosition(texts[0].matrix);
    expect(position.x).toBeCloseTo(0, 6);
    expect(position.y).toBeCloseTo(0.03, 6);
    expect(position.z).toBeCloseTo(0.051, 6);
    expect(new THREE.Vector3().setFromMatrixScale(texts[0].matrix).x).toBeCloseTo(0.5, 6);
    orbs[2].visible = false;
    glyphs.update();
    expect(texts[2].matrix.determinant()).toBe(0);
  });

  it('rebuilds glyph batch data only after a glyph moves', async () => {
    const { BatchedText, Text } = await import('troika-three-text');
    const { root, orbs } = keyboard();
    const glyphs = createKeyborbGlyphs(orbs);
    root.add(glyphs.batch);
    const revision = glyphs.batch.revision;
    glyphs.update();
    expect(glyphs.batch.revision).toBe(revision);
    const rebuild = vi
      .spyOn(BatchedText.prototype, '_prepareForRender')
      .mockImplementation(() => {});
    const own = vi.spyOn(Text.prototype, '_prepareForRender').mockImplementation(() => {});
    const material = Object.assign(
      new THREE.ShaderMaterial({ uniforms: { uTroikaIsOutline: { value: true } } }),
      { setMatrixTexture: vi.fn() },
    );
    const batch = glyphs.batch as unknown as { _dataTextures: Record<string, THREE.DataTexture> };
    batch._dataTextures.main = new THREE.DataTexture(new Float32Array(4), 1, 1);
    for (let eye = 0; eye < 2; eye++) glyphs.batch._prepareForRender(material);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
    expect(material.setMatrixTexture).toHaveBeenCalledWith(batch._dataTextures.main);
    expect(material.uniforms.uTroikaIsOutline.value).toBe(false);
    // troika's outline material shares the main material's uniforms.
    const outline = Object.assign(Object.create(material) as typeof material, {
      isTextOutlineMaterial: true,
    });
    batch._dataTextures.outline = new THREE.DataTexture(new Float32Array(4), 1, 1);
    for (let pass = 0; pass < 2; pass++) glyphs.batch._prepareForRender(outline);
    expect(material.uniforms.uTroikaIsOutline.value).toBe(true);
    glyphs.batch._prepareForRender(material);
    expect(material.uniforms.uTroikaIsOutline.value).toBe(false);
    expect(rebuild).toHaveBeenCalledTimes(2);
    orbs[1].position.y = 0.02;
    glyphs.update();
    expect(glyphs.batch.revision).toBe(revision + 1);
    glyphs.batch._prepareForRender(material);
    expect(rebuild).toHaveBeenCalledTimes(3);
    glyphs.batch.dispatchEvent({ type: 'synccomplete' });
    glyphs.batch._prepareForRender(material);
    expect(rebuild).toHaveBeenCalledTimes(4);
    rebuild.mockRestore();
    own.mockRestore();
  });

  it('keeps the batches unwarped and drawn after the shells when the keyboard curves', () => {
    const { root, orbs } = keyboard();
    const shells = createKeyborbShells(orbs);
    const glyphs = createKeyborbGlyphs(orbs);
    root.add(shells.mesh, glyphs.batch);
    curveKeyboardContent(root, 1.2, THREE.MathUtils.degToRad(40));
    expect(shells.mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(glyphs.batch.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    expect(glyphs.batch.renderOrder).toBeGreaterThan(shells.mesh.renderOrder);
    expect(orbs[2].rotation.y).not.toBe(0);
  });
});
