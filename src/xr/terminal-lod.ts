import type { TerminalRenderQuality } from '../contracts';

export function terminalQualityAtDistance(
  distance: number,
  previous: TerminalRenderQuality,
): TerminalRenderQuality {
  if (!Number.isFinite(distance)) return 'full';
  const near = previous === 'full' ? 3.9 : 3.1;
  const far = previous === 'low' ? 6.5 : 7.5;
  if (distance < near) return 'full';
  if (distance > far) return 'low';
  return 'medium';
}
