export type HierarchyStyle = 'helix' | 'spatial-docks';

export const DEFAULT_HIERARCHY_STYLE: HierarchyStyle = 'helix';

export function validateHierarchyStyle(value: unknown): HierarchyStyle {
  return value === 'spatial-docks' || value === 'helix' ? value : DEFAULT_HIERARCHY_STYLE;
}
