import * as THREE from 'three';

const HORIZONTAL_SLOPE = Math.tan(THREE.MathUtils.degToRad(45));
const VERTICAL_SLOPE = Math.tan(THREE.MathUtils.degToRad(36));

/** Keeps a new widget above the floor and its center within the forward view. */
export function keepWidgetSpawnInView(
  root: THREE.Group,
  eye: THREE.Vector3,
  heading: THREE.Quaternion,
  floor: number,
  fitView: boolean,
): void {
  root.updateWorldMatrix(true, true);
  const toHeading = new THREE.Matrix4()
    .makeRotationFromQuaternion(heading.clone().invert())
    .multiply(new THREE.Matrix4().makeTranslation(-eye.x, -eye.y, -eye.z));
  const bounds = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  const transform = new THREE.Matrix4();
  root.traverseVisible((object) => {
    if (object.parent?.userData.labelTextObject === object) return;
    const geometry = (object as THREE.Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    transform.multiplyMatrices(toHeading, object.matrixWorld);
    bounds.union(meshBounds.copy(box).applyMatrix4(transform));
  });
  if (bounds.isEmpty()) return;

  const floorLift = floor - eye.y - bounds.min.y;
  const delta = new THREE.Vector3(0, Math.max(0, floorLift), 0);
  if (fitView) {
    const center = bounds.getCenter(new THREE.Vector3());
    const depth = Math.max(0.3, -center.z);
    const maxX = depth * HORIZONTAL_SLOPE;
    const maxY = depth * VERTICAL_SLOPE;
    delta.x = THREE.MathUtils.clamp(center.x, -maxX, maxX) - center.x;
    const minY = Math.max(floorLift, -maxY - center.y);
    delta.y = THREE.MathUtils.clamp(0, minY, Math.max(minY, maxY - center.y));
    delta.z = -depth - center.z;
  }
  root.position.add(delta.applyQuaternion(heading));
}
