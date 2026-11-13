import * as THREE from 'three';

/** The XR interface accent everything uses until a custom accent is chosen. */
export const DEFAULT_ACCENT = 0x68d6ff;
/** Pointer hover highlight for the default accent. */
export const DEFAULT_ACCENT_HOVER = 0x9deaff;
/** Share of the way from a custom accent to white used for the hover highlight. */
const HOVER_LIGHTEN = 0.4;

/** Rec. 709 relative luminance of a linear color. */
export function linearLuminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Sets `target` to `accent` scaled to the linear luminance of `authored`, so a retinted glow keeps
 * the brightness it was designed at. Without an accent, `target` becomes `authored` unchanged.
 */
export function tintToLuminance(
  target: THREE.Color,
  authored: THREE.Color,
  accent: THREE.Color | null,
): THREE.Color {
  if (!accent) return target.copy(authored);
  const want = linearLuminance(authored);
  const have = linearLuminance(accent);
  if (have <= 0) return target.setScalar(want);
  const scale = want / have;
  return target.setRGB(
    Math.min(1, accent.r * scale),
    Math.min(1, accent.g * scale),
    Math.min(1, accent.b * scale),
  );
}

/**
 * The resolved hex a material tagged with `original` shows under `accent`: the original itself
 * for the default accent, the custom accent otherwise.
 */
export function resolveAccent(accent: string, original = DEFAULT_ACCENT): number {
  return accent ? new THREE.Color(accent).getHex() : original;
}

/** The hover highlight under `accent`: the authored highlight, or the accent lightened. */
export function resolveAccentHover(accent: string): number {
  if (!accent) return DEFAULT_ACCENT_HOVER;
  return new THREE.Color(accent).lerp(new THREE.Color(0xffffff), HOVER_LIGHTEN).getHex();
}

/** A `#rrggbb` CSS color for canvas-drawn accents such as label borders. */
export function resolveAccentCss(accent: string, original: string): string {
  return accent || original;
}

/**
 * Tags a material whose color is an accent. `original` is its default-accent color, so switching
 * back to Default restores each site's own authored cyan rather than one shared value.
 */
export function tagAccentMaterial<T extends THREE.Material>(material: T, original: number): T {
  material.userData.accentOriginal = original;
  return material;
}

type Colored = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };

/**
 * Moves every accent-colored material under `root` from `previous` to `next`. A material matches
 * when its color (or emissive) currently shows the previous resolved accent for its original, so
 * a state color such as a selected pane's white is left alone and keeps reading the live accent.
 */
export function retintAccentMaterials(root: THREE.Object3D, previous: string, next: string): void {
  if (previous === next) return;
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as Colored | Colored[] | undefined;
    if (!material) return;
    for (const each of Array.isArray(material) ? material : [material]) {
      if (seen.has(each)) continue;
      seen.add(each);
      const original = (each.userData.accentOriginal as number | undefined) ?? DEFAULT_ACCENT;
      const from = resolveAccent(previous, original);
      const to = resolveAccent(next, original);
      for (const color of [each.color, each.emissive])
        if (color && color.getHex() === from) color.setHex(to);
    }
  });
}

/** The environment accent a state resolves to: its own, else the interface accent, else none. */
export function resolveEnvironmentAccent(state: {
  accentColor: string;
  environmentAccentColor: string;
}): string {
  return state.environmentAccentColor || state.accentColor || '';
}

/** A linear THREE.Color for a `#rrggbb` accent, or null for the authored default. */
export function accentColorOrNull(accent: string): THREE.Color | null {
  return accent ? new THREE.Color(accent) : null;
}
