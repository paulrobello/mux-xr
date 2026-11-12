import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { describe, expect, it } from 'vitest';
import {
  createLabelBatcher,
  LABEL_BATCH_HIDDEN_LAYER,
  type LabelTextBatch,
  labelBatchTransparentSort,
} from '../src/xr/label-batches';
import { measurePanelBounds } from '../src/xr/panel-bounds';

function fakeLabel(width = 0.3, height = 0.1): THREE.Mesh {
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  const text = new Text();
  text.position.z = 0.001;
  label.add(text);
  label.userData.labelTextObject = text;
  return label;
}

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 0, 2);
  camera.updateMatrixWorld(true);
  const labels = new Set<THREE.Mesh>();
  const batcher = createLabelBatcher(scene, () => labels);
  const frame = (): void => {
    scene.updateMatrixWorld(true);
    batcher.update(camera);
  };
  return { scene, camera, labels, batcher, frame };
}

const textOf = (label: THREE.Mesh): Text => label.userData.labelTextObject as Text;
const batchOf = (root: THREE.Object3D): LabelTextBatch | undefined =>
  root.children.find((child) => child.userData.labelTextBatch) as LabelTextBatch | undefined;

describe('label text batches', () => {
  it('draws every label text under one scene child through one batch placed like the text', () => {
    const { scene, labels, batcher, frame } = setup();
    const widget = new THREE.Group();
    widget.position.set(0.4, 1.2, -1);
    widget.rotation.y = 0.3;
    widget.scale.setScalar(1.5);
    scene.add(widget);
    const first = fakeLabel();
    const second = fakeLabel();
    first.position.set(-0.1, 0.05, 0.03);
    second.position.set(0.1, -0.05, 0.03);
    widget.add(first, second);
    labels.add(first).add(second);
    frame();
    const batch = batchOf(widget);
    expect(batch).toBeDefined();
    expect(batcher.batches.size).toBe(1);
    expect([...(batch as LabelTextBatch).memberMatrices.keys()]).toEqual([
      textOf(first),
      textOf(second),
    ]);
    // Batch space times member matrix lands the glyphs where the Text itself sits.
    const placed = new THREE.Matrix4().multiplyMatrices(
      (batch as LabelTextBatch).matrixWorld,
      (batch as LabelTextBatch).memberMatrices.get(textOf(second)) as THREE.Matrix4,
    );
    const at = new THREE.Vector3().setFromMatrixPosition(placed);
    const expected = new THREE.Vector3().setFromMatrixPosition(textOf(second).matrixWorld);
    expect(at.distanceTo(expected)).toBeLessThan(1e-5);
  });

  it('zero-scales a member under a hidden ancestor and keeps it a member', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    const page = new THREE.Group();
    const label = fakeLabel();
    page.add(label);
    root.add(page);
    scene.add(root);
    labels.add(label);
    frame();
    const batch = batchOf(root) as LabelTextBatch;
    const revision = batch.revision;
    page.visible = false;
    frame();
    const matrix = batch.memberMatrices.get(textOf(label)) as THREE.Matrix4;
    expect(matrix.elements.every((value) => value === 0)).toBe(true);
    expect(batch.revision).toBeGreaterThan(revision);
    const settled = batch.revision;
    frame();
    expect(batch.revision).toBe(settled);
  });

  it('leaves faded, overlay and keyborb-owned text to draw on its own', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const faded = fakeLabel();
    const overlay = fakeLabel();
    const taken = fakeLabel();
    const plain = fakeLabel();
    root.add(faded, overlay, taken, plain);
    for (const label of [faded, overlay, taken, plain]) labels.add(label);
    (textOf(faded).material as THREE.Material).opacity = 0.5;
    (textOf(overlay).material as THREE.Material).depthTest = false;
    taken.remove(textOf(taken));
    frame();
    const batch = batchOf(root) as LabelTextBatch;
    expect([...batch.memberMatrices.keys()]).toEqual([textOf(plain)]);
    expect(textOf(faded).layers.isEnabled(0)).toBe(true);
  });

  it('returns a text to normal drawing when its label fades or is released', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const label = fakeLabel();
    const other = fakeLabel();
    root.add(label, other);
    labels.add(label).add(other);
    frame();
    const batch = batchOf(root) as LabelTextBatch;
    textOf(label).layers.set(LABEL_BATCH_HIDDEN_LAYER);
    (textOf(label).material as THREE.Material).opacity = 0.4;
    frame();
    expect(batch.memberMatrices.has(textOf(label))).toBe(false);
    expect(textOf(label).layers.isEnabled(0)).toBe(true);
    (label.userData.labelBatchRelease as (() => void) | undefined)?.();
    (textOf(label).material as THREE.Material).opacity = 1;
    frame();
    expect(batch.memberMatrices.has(textOf(label))).toBe(true);
    (label.userData.labelBatchRelease as () => void)();
    expect(batch.memberMatrices.has(textOf(label))).toBe(false);
    expect(label.userData.labelBatchRelease).toBeUndefined();
  });

  it('hides a member only once the batch has glyphs for it', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const label = fakeLabel();
    root.add(label);
    labels.add(label);
    frame();
    const text = textOf(label);
    expect(text.layers.isEnabled(0)).toBe(true);
    Object.defineProperty(text, 'textRenderInfo', { value: { blockBounds: [0, 0, 1, 1] } });
    (batchOf(root) as LabelTextBatch).dispatchEvent({ type: 'synccomplete' });
    expect(text.layers.isEnabled(LABEL_BATCH_HIDDEN_LAYER)).toBe(true);
    expect(text.layers.isEnabled(0)).toBe(false);
  });

  it('keeps separate batches per render order and drops a batch whose labels are gone', () => {
    const { scene, labels, batcher, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const key = fakeLabel();
    const caption = fakeLabel();
    textOf(key).renderOrder = 11;
    root.add(key, caption);
    labels.add(key).add(caption);
    frame();
    expect(batcher.batches.size).toBe(2);
    expect([...batcher.batches].map((batch) => batch.renderOrder).sort()).toEqual([0, 11]);
    labels.delete(key);
    key.userData.labelDisposed = true;
    (key.userData.labelBatchRelease as () => void)();
    frame();
    expect(batcher.batches.size).toBe(1);
    root.removeFromParent();
    frame();
    expect(batcher.batches.size).toBe(0);
    expect(textOf(caption).layers.isEnabled(0)).toBe(true);
  });

  it('does not change measured panel bounds', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const label = fakeLabel(0.4, 0.1);
    label.position.set(0.2, 0.3, 0);
    root.add(label);
    labels.add(label);
    const before = measurePanelBounds(root);
    frame();
    expect(batchOf(root)).toBeDefined();
    expect(measurePanelBounds(root)).toEqual(before);
  });

  it('keeps the label plane as the ray target', () => {
    const { scene, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const label = fakeLabel();
    label.userData.inputAction = 'press';
    root.add(label);
    labels.add(label);
    frame();
    const hits = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1))
      .intersectObject(root, true)
      .map((hit) => hit.object);
    expect(hits[0]).toBe(label);
    expect(hits.some((object) => object.userData.labelTextBatch)).toBe(false);
  });

  it('sorts a batch after its nearest plate but before a nearer transparent surface', () => {
    const { scene, camera, labels, frame } = setup();
    const root = new THREE.Group();
    scene.add(root);
    const far = fakeLabel();
    const near = fakeLabel();
    far.position.z = -0.4;
    near.position.z = 0.2;
    root.add(far, near);
    labels.add(far).add(near);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    glass.position.z = 0.8;
    scene.add(glass);
    frame();
    const batch = batchOf(root) as LabelTextBatch;
    const projection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const depth = (object: THREE.Object3D): number =>
      new THREE.Vector4(0, 0, 0, 1).applyMatrix4(object.matrixWorld).applyMatrix4(projection).z;
    const item = (object: THREE.Object3D, id: number) => ({
      groupOrder: 0,
      renderOrder: 0,
      z: depth(object),
      id,
      object,
    });
    const order = [item(batch, 1), item(glass, 2), item(near, 3), item(far, 4)]
      .sort(labelBatchTransparentSort)
      .map((entry) => entry.object);
    expect(order).toEqual([far, near, batch, glass]);
  });
});
