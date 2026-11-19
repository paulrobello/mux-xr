import * as THREE from 'three';

export interface HandSurfaceTheme {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
}

export interface HandTheme {
  hand?: HandSurfaceTheme;
  sleeve?: HandSurfaceTheme;
}

export function applyHandSurface(
  target: THREE.MeshStandardMaterial,
  surface: HandSurfaceTheme | undefined,
): void {
  if (!surface) return;
  if (surface.color !== undefined) target.color.set(surface.color);
  if (surface.roughness !== undefined)
    target.roughness = THREE.MathUtils.clamp(surface.roughness, 0, 1);
  if (surface.metalness !== undefined)
    target.metalness = THREE.MathUtils.clamp(surface.metalness, 0, 1);
  if (surface.emissive !== undefined) target.emissive.set(surface.emissive);
  if (surface.emissiveIntensity !== undefined)
    target.emissiveIntensity = Math.max(0, surface.emissiveIntensity);
}

/** Hand color choices offered in the XR World settings; an empty color keeps the model's own. */
export const HAND_COLOR_PRESETS = [
  { name: 'Default', color: '' },
  { name: 'Red', color: '#dc2626' },
  { name: 'Orange', color: '#ff672f' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Green', color: '#22a55a' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Pink', color: '#ec4899' },
  { name: 'Gold', color: '#c9921a' },
] as const;

/** Every hand and arm color, defaults included, displays at this share of its sRGB brightness. */
export const HAND_BRIGHTNESS = 0.8;
const rgb = { r: 0, g: 0, b: 0 };

/** Sets `target` to `color` dimmed by {@link HAND_BRIGHTNESS} in display (sRGB) values. */
export function dimHandColor(target: THREE.Color, color: THREE.ColorRepresentation): THREE.Color {
  target.set(color).getRGB(rgb, THREE.SRGBColorSpace);
  return target.setRGB(
    rgb.r * HAND_BRIGHTNESS,
    rgb.g * HAND_BRIGHTNESS,
    rgb.b * HAND_BRIGHTNESS,
    THREE.SRGBColorSpace,
  );
}

/** A lowercase `#rrggbb` color, or empty (the default) for anything else. */
export function validateHandColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
}
