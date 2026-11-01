import * as THREE from 'three';
import type { PanelArrangement } from '../contracts';

export interface ArrangementPanelSize {
  width: number;
  height: number;
}

export interface ArrangementPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const VIEWER_DISTANCE = 2.3;
const PANEL_GAP = 0.12;
const MAX_FRONT_ANGLE = 1.15;

const poseAt = (position: THREE.Vector3): ArrangementPose => {
  const front = position.clone().negate().normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(front, -front.y).normalize();
  const right = up.clone().cross(front).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, front);
  return { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(basis) };
};

const rowArrangement = (sizes: readonly ArrangementPanelSize[]): ArrangementPose[] => {
  const width =
    sizes.reduce((total, size) => total + size.width, 0) + PANEL_GAP * (sizes.length - 1);
  let x = -width / 2;
  return sizes.map((size) => {
    x += size.width / 2;
    const pose = poseAt(new THREE.Vector3(x, 0, -VIEWER_DISTANCE));
    x += size.width / 2 + PANEL_GAP;
    return pose;
  });
};

const gridDimensions = (count: number): { columns: number; rows: number } => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { columns, rows: Math.ceil(count / columns) };
};

const gridArrangement = (sizes: readonly ArrangementPanelSize[]): ArrangementPose[] => {
  const { columns, rows } = gridDimensions(sizes.length);
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...sizes.filter((_, index) => index % columns === column).map((size) => size.width)),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * columns, (row + 1) * columns).map((size) => size.height)),
  );
  const totalWidth =
    columnWidths.reduce((sum, value) => sum + value, 0) + PANEL_GAP * (columns - 1);
  const totalHeight = rowHeights.reduce((sum, value) => sum + value, 0) + PANEL_GAP * (rows - 1);
  const xStarts: number[] = [];
  let x = -totalWidth / 2;
  for (const columnWidth of columnWidths) {
    xStarts.push(x);
    x += columnWidth + PANEL_GAP;
  }
  const yStarts: number[] = [];
  let y = totalHeight / 2;
  for (const rowHeight of rowHeights) {
    yStarts.push(y);
    y -= rowHeight + PANEL_GAP;
  }
  return sizes.map((_size, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return poseAt(
      new THREE.Vector3(
        xStarts[column] + columnWidths[column] / 2,
        yStarts[row] - rowHeights[row] / 2,
        -VIEWER_DISTANCE,
      ),
    );
  });
};

const arcArrangement = (sizes: readonly ArrangementPanelSize[]): ArrangementPose[] => {
  if (sizes.length === 1) return [poseAt(new THREE.Vector3(0, 0, -VIEWER_DISTANCE))];
  const maxWidth = Math.max(...sizes.map((size) => size.width));
  const angularSpan = Math.min(2 * MAX_FRONT_ANGLE, (sizes.length - 1) * 0.65);
  const angularStep = angularSpan / (sizes.length - 1);
  const radius = Math.max(
    VIEWER_DISTANCE,
    (maxWidth + PANEL_GAP) / (2 * Math.sin(angularStep / 2)),
  );
  const center = (sizes.length - 1) / 2;
  return sizes.map((_size, index) => {
    const angle = (index - center) * angularStep;
    return poseAt(new THREE.Vector3(radius * Math.sin(angle), 0, -radius * Math.cos(angle)));
  });
};

const sphereArrangement = (sizes: readonly ArrangementPanelSize[]): ArrangementPose[] => {
  const { columns, rows } = gridDimensions(sizes.length);
  const maxWidth = Math.max(...sizes.map((size) => size.width));
  const maxHeight = Math.max(...sizes.map((size) => size.height));
  const horizontalSpan = Math.min(1.8, (columns - 1) * 0.65);
  const verticalSpan = Math.min(1.2, (rows - 1) * 0.45);
  const horizontalStep = columns > 1 ? horizontalSpan / (columns - 1) : 0;
  const verticalStep = rows > 1 ? verticalSpan / (rows - 1) : 0;
  const horizontalRadius =
    horizontalStep > 0
      ? (maxWidth + PANEL_GAP) / (2 * Math.sin(horizontalStep / 2) * Math.cos(verticalSpan / 2))
      : VIEWER_DISTANCE;
  const verticalRadius =
    verticalStep > 0 ? (maxHeight + PANEL_GAP) / (2 * Math.sin(verticalStep / 2)) : VIEWER_DISTANCE;
  const radius = Math.max(VIEWER_DISTANCE, horizontalRadius, verticalRadius);
  const horizontalCenter = (columns - 1) / 2;
  const verticalCenter = (rows - 1) / 2;
  return sizes.map((_size, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const horizontal = (column - horizontalCenter) * horizontalStep;
    const vertical = (verticalCenter - row) * verticalStep;
    const cosVertical = Math.cos(vertical);
    return poseAt(
      new THREE.Vector3(
        radius * Math.sin(horizontal) * cosVertical,
        radius * Math.sin(vertical),
        -radius * Math.cos(horizontal) * cosVertical,
      ),
    );
  });
};

export const calculateArrangement = (
  pattern: PanelArrangement,
  sizes: readonly ArrangementPanelSize[],
): ArrangementPose[] => {
  if (sizes.length === 0) return [];
  switch (pattern) {
    case 'row':
      return rowArrangement(sizes);
    case 'grid':
      return gridArrangement(sizes);
    case 'arc':
      return arcArrangement(sizes);
    case 'sphere':
      return sphereArrangement(sizes);
  }
};
