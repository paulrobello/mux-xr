export type KeyborbMode = 'off' | 'on' | 'auto';

export function validateKeyborbMode(value: unknown): KeyborbMode {
  return value === 'off' || value === 'on' ? value : 'auto';
}

export function keyborbEnabled(mode: KeyborbMode, handTrackingActive: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && handTrackingActive);
}
