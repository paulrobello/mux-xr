export function validateKeyboardCurvature(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}
