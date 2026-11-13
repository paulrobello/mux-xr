import * as THREE from 'three';
import type { Text, TroikaTextMaterial } from 'troika-three-text';
import { CachedTextBatch } from './text-batch';

/** A layer no camera renders: batched label text stays in the scene graph but draws via its batch. */
export const LABEL_BATCH_HIDDEN_LAYER = 31;

const zeroMatrix = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const tempBox = new THREE.Box3();

/**
 * One draw for every label text under one scene child at one render order. Member placement is
 * written per frame into `memberMatrices` in batch space; the Text objects keep their own scene
 * matrices so fades, overlays and bounds code that walk the scene graph still see them.
 */
export class LabelTextBatch extends CachedTextBatch {
  readonly memberMatrices = new Map<Text, THREE.Matrix4>();
  /** Transparent sort depth: just in front of the nearest member label. */
  sortDepth: number | null = null;

  constructor() {
    super();
    this.name = 'label-text-batch';
    this.depthOffset = -1;
    this.raycast = () => undefined;
    this.userData.excludeFromBounds = true;
    this.userData.labelTextBatch = true;
  }

  override updateBounds(): void {
    if (this.boundsRevision === this.revision) return;
    this.boundsRevision = this.revision;
    const geometry = this.geometry;
    if (!geometry.boundingBox) geometry.boundingBox = new THREE.Box3();
    if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
    const box = geometry.boundingBox.makeEmpty();
    for (const [text, matrix] of this.memberMatrices) {
      const bounds = text.geometry.boundingBox;
      if (!bounds || bounds.isEmpty() || matrix.elements[15] === 0) continue;
      box.union(tempBox.copy(bounds).applyMatrix4(matrix));
    }
    if (box.isEmpty()) geometry.boundingSphere.set(new THREE.Vector3(), 0);
    else box.getBoundingSphere(geometry.boundingSphere);
  }

  protected override rebuildMemberData(material: TroikaTextMaterial): void {
    // Stock BatchedText reads each member's own `matrix`; lend it the batch-space one meanwhile.
    const saved: Array<[Text, THREE.Matrix4]> = [];
    for (const [text, matrix] of this.memberMatrices) {
      saved.push([text, text.matrix]);
      text.matrix = matrix;
    }
    try {
      super.rebuildMemberData(material);
    } finally {
      for (const [text, matrix] of saved) text.matrix = matrix;
    }
  }
}

interface Member {
  label: THREE.Mesh;
  batch: LabelTextBatch;
  layers: number;
}

export interface LabelBatcher {
  /** Batches currently in the scene. */
  readonly batches: ReadonlySet<LabelTextBatch>;
  /** Assigns, places and orders batched label text. Runs from `scene.onBeforeRender`. */
  update(camera: THREE.Camera): void;
  dispose(): void;
}

function batchable(text: Text): boolean {
  const material = text.material;
  if (Array.isArray(material)) return false;
  // Only text in its default draw state shares the batch material. A fade, an overlay that skips
  // depth testing or a hidden material draws the Text on its own, as before batching.
  return material.visible && material.depthTest && material.opacity === 1;
}

/**
 * Draws label text through one troika batch per scene child and render order, so a widget or pane
 * costs one text draw instead of one per label. Each draw costs about 0.02 ms of main thread on
 * Quest 3. Install `labelBatchTransparentSort` on the renderer alongside it.
 */
export function createLabelBatcher(
  scene: THREE.Scene,
  labels: () => Iterable<THREE.Mesh>,
): LabelBatcher {
  const members = new Map<Text, Member>();
  const byRoot = new Map<THREE.Object3D, Map<number, LabelTextBatch>>();
  const batches = new Set<LabelTextBatch>();
  const projection = new THREE.Matrix4();
  const next = new THREE.Matrix4();
  const point = new THREE.Vector4();
  const inverses = new Map<LabelTextBatch, THREE.Matrix4 | null>();
  const inverseStore = new WeakMap<LabelTextBatch, THREE.Matrix4>();
  const changed = new Set<LabelTextBatch>();

  const release = (text: Text): void => {
    const member = members.get(text);
    if (!member) return;
    members.delete(text);
    member.batch.removeText(text);
    member.batch.memberMatrices.delete(text);
    member.batch.revision++;
    text.layers.mask = member.layers;
    member.label.userData.labelBatchRelease = undefined;
  };

  const batchFor = (root: THREE.Object3D, order: number): LabelTextBatch => {
    let orders = byRoot.get(root);
    if (!orders) {
      orders = new Map();
      byRoot.set(root, orders);
    }
    let batch = orders.get(order);
    if (batch) return batch;
    const created = new LabelTextBatch();
    created.renderOrder = order;
    // A batch draws in the same render pass as the root it belongs to.
    created.layers.mask = root.layers.mask;
    // A member's own Text stays drawn until the batch has glyphs for it, so nothing blinks.
    created.addEventListener('synccomplete', () => {
      for (const [text, member] of members)
        if (member.batch === created && text.textRenderInfo)
          text.layers.set(LABEL_BATCH_HIDDEN_LAYER);
    });
    root.add(created);
    created.updateMatrixWorld(true);
    orders.set(order, created);
    batches.add(created);
    batch = created;
    return batch;
  };

  const removeBatch = (batch: LabelTextBatch): void => {
    for (const [root, orders] of byRoot)
      for (const [order, value] of orders)
        if (value === batch) {
          orders.delete(order);
          if (orders.size === 0) byRoot.delete(root);
        }
    batch.removeFromParent();
    batch.dispose();
    batches.delete(batch);
  };

  const update = (camera: THREE.Camera): void => {
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inverses.clear();
    changed.clear();
    for (const batch of batches) batch.sortDepth = null;
    for (const label of labels()) {
      const data = label.userData;
      const text = data.labelTextObject as Text | undefined;
      if (!text) continue;
      if (data.labelDisposed || text.parent !== label) {
        release(text);
        continue;
      }
      let visible = true;
      let root: THREE.Object3D | null = null;
      for (let node: THREE.Object3D | null = text; node; node = node.parent) {
        if (!node.visible) visible = false;
        if (node.parent === scene) {
          root = node;
          break;
        }
      }
      if (!root || root === label || !batchable(text)) {
        release(text);
        continue;
      }
      const batch = batchFor(root, text.renderOrder);
      let member = members.get(text);
      if (member && member.batch !== batch) {
        release(text);
        member = undefined;
      }
      if (!member) {
        member = { label, batch, layers: text.layers.mask };
        members.set(text, member);
        batch.addText(text);
        batch.memberMatrices.set(text, new THREE.Matrix4().copy(zeroMatrix));
        data.labelBatchRelease = () => release(text);
        changed.add(batch);
      }
      let batchInverse = inverses.get(batch);
      if (batchInverse === undefined) {
        let stored = inverseStore.get(batch);
        if (!stored) {
          stored = new THREE.Matrix4();
          inverseStore.set(batch, stored);
        }
        batchInverse =
          Math.abs(batch.matrixWorld.determinant()) < 1e-12
            ? null
            : stored.copy(batch.matrixWorld).invert();
        inverses.set(batch, batchInverse);
      }
      if (visible && batchInverse) next.multiplyMatrices(batchInverse, text.matrixWorld);
      else next.copy(zeroMatrix);
      const stored = batch.memberMatrices.get(text) as THREE.Matrix4;
      const elements = stored.elements;
      for (let i = 0; i < 16; i++) {
        // The batch stores float32, so compare and keep the rounded values.
        const value = Math.fround(next.elements[i]);
        if (elements[i] === value) continue;
        elements[i] = value;
        changed.add(batch);
      }
      if (visible) {
        point.set(0, 0, 0, 1).applyMatrix4(label.matrixWorld).applyMatrix4(projection);
        if (batch.sortDepth === null || point.z < batch.sortDepth) batch.sortDepth = point.z;
      }
    }
    for (const batch of changed) batch.revision++;
    for (const batch of [...batches])
      if (batch.memberMatrices.size === 0 || batch.parent?.parent !== scene) {
        for (const text of [...batch.memberMatrices.keys()]) release(text);
        removeBatch(batch);
      }
  };

  // three calls a Scene's hook as (renderer, scene, camera, renderTarget), after updating world
  // matrices and before projecting objects, so members placed here draw this frame.
  const previous = scene.onBeforeRender;
  scene.onBeforeRender = function (this: THREE.Scene, ...args: Parameters<typeof previous>) {
    previous.apply(this, args);
    update(args[2]);
  };

  return {
    batches,
    update,
    dispose() {
      scene.onBeforeRender = previous;
      for (const text of [...members.keys()]) release(text);
      for (const batch of [...batches]) removeBatch(batch);
    },
  };
}

interface SortItem {
  groupOrder: number;
  renderOrder: number;
  z: number;
  id: number;
  object: THREE.Object3D;
}

/**
 * three's default transparent order, except a label batch sorts just in front of its nearest member
 * label, so it draws after every plate it covers but before nearer transparent surfaces.
 */
export function labelBatchTransparentSort(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const az = sortDepth(a);
  const bz = sortDepth(b);
  if (az !== bz) return bz - az;
  return a.id - b.id;
}

function sortDepth(item: SortItem): number {
  const object = item.object as THREE.Object3D & { sortDepth?: number | null };
  // Equal depths fall back to id order, which can put a batch before its nearest plate.
  return object.userData.labelTextBatch && typeof object.sortDepth === 'number'
    ? object.sortDepth - 1e-6
    : item.z;
}
