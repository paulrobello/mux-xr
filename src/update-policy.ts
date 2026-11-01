export function shouldAutoReload(
  available: boolean,
  mode: 'desktop' | 'vr' | 'ar',
  enteringXR = false,
): boolean {
  return available && mode === 'desktop' && !enteringXR;
}
