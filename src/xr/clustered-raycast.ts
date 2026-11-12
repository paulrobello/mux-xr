import * as THREE from 'three';

/** Triangles per cluster. Builders emit triangles along a path, so a run stays spatially compact. */
const CLUSTER_TRIANGLES = 16;

interface Cluster {
  start: number;
  count: number;
  box: THREE.Box3;
}

const clusterCache = new WeakMap<THREE.BufferGeometry, Cluster[]>();
const inverse = new THREE.Matrix4();
const localRay = new THREE.Ray();
const corner = new THREE.Vector3();

function clustersOf(geometry: THREE.BufferGeometry): Cluster[] {
  const cached = clusterCache.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const total = index ? index.count : position.count;
  const step = CLUSTER_TRIANGLES * 3;
  const clusters: Cluster[] = [];
  for (let start = 0; start < total; start += step) {
    const count = Math.min(step, total - start);
    const box = new THREE.Box3();
    for (let i = start; i < start + count; i++)
      box.expandByPoint(corner.fromBufferAttribute(position, index ? index.getX(i) : i));
    clusters.push({ start, count, box });
  }
  clusterCache.set(geometry, clusters);
  // A rebuilt or edited geometry is a new object or gets disposed; either way drop its clusters.
  geometry.addEventListener('dispose', () => clusterCache.delete(geometry));
  return clusters;
}

/**
 * Raycasts a static, non-grouped mesh by testing only the triangle runs whose bounds the ray
 * crosses. Hits are exactly three's own, since each run goes through `Mesh.raycast` with the
 * geometry's draw range narrowed to it. Geometry edited in place must be replaced, not mutated.
 */
export function clusteredRaycast(
  this: THREE.Mesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  const geometry = this.geometry;
  if (geometry.groups.length > 0 || Array.isArray(this.material)) {
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
    return;
  }
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  inverse.copy(this.matrixWorld).invert();
  localRay.copy(raycaster.ray).applyMatrix4(inverse);
  const range = geometry.drawRange;
  const { start, count } = range;
  try {
    for (const cluster of clustersOf(geometry)) {
      if (!localRay.intersectsBox(cluster.box)) continue;
      range.start = cluster.start;
      range.count = cluster.count;
      THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
    }
  } finally {
    range.start = start;
    range.count = count;
  }
}
