/** Hand color choices offered in the XR World settings; an empty color keeps the model's own. */
export const HAND_COLOR_PRESETS = [
  { name: 'Default', color: '' },
  { name: 'Orange', color: '#ff672f' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Green', color: '#22a55a' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Pink', color: '#ec4899' },
  { name: 'Gold', color: '#c9921a' },
] as const;

/** A lowercase `#rrggbb` color, or empty (the default) for anything else. */
export function validateHandColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
}
