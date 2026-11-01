import type { TerminalColorMode } from '../contracts';

const ANSI16 = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
] as const;

function rgb(value: number): [number, number, number] {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function comfort(red: number, green: number, blue: number, background: boolean): string {
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  if (blue > red * 1.2 && blue > green * 1.1) {
    const target = background ? luminance : Math.min(220, 150 + luminance * 0.45);
    return hex(target * 0.82, target * 0.98, target);
  }
  const base = background ? luminance : Math.max(luminance, 48);
  const factor = 0.72;
  return hex(
    base + (red - luminance) * factor,
    base + (green - luminance) * factor,
    base + (blue - luminance) * factor,
  );
}

function monochrome(red: number, green: number, blue: number, background: boolean): string {
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const level = background ? luminance : Math.max(120, luminance);
  return hex(level, level, level);
}

function paletteRgb(value: number): [number, number, number] {
  if (value < 16) {
    const named = ANSI16[value];
    return named ? rgb(Number.parseInt(named.slice(1), 16)) : [0, 0, 0];
  }
  if (value < 232) {
    const index = value - 16;
    const component = (channel: number): number => (channel === 0 ? 0 : 55 + channel * 40);
    return [
      component(Math.floor(index / 36)),
      component(Math.floor(index / 6) % 6),
      component(index % 6),
    ];
  }
  const shade = 8 + (value - 232) * 10;
  return [shade, shade, shade];
}

function fallbackRgb(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? rgb(Number.parseInt(match[1], 16)) : null;
}

export function terminalColor(
  mode: TerminalColorMode,
  isRgb: boolean,
  isPalette: boolean,
  value: number,
  fallback: string,
  bright = false,
  background = false,
): string {
  if (!isRgb && !isPalette) {
    if (mode === 'monochrome') {
      const fallbackColor = fallbackRgb(fallback);
      return fallbackColor ? monochrome(...fallbackColor, background) : fallback;
    }
    return fallback;
  }
  if (isPalette && (!Number.isInteger(value) || value < 0 || value > 255)) return fallback;
  const paletteValue = isPalette ? (bright && value >= 0 && value < 8 ? value + 8 : value) : -1;
  const [red, green, blue] = isRgb ? rgb(value) : paletteRgb(paletteValue);
  if (mode === 'original')
    return isRgb ? `rgb(${red},${green},${blue})` : (ANSI16[paletteValue] ?? hex(red, green, blue));
  if (mode === 'monochrome') return monochrome(red, green, blue, background);
  return comfort(red, green, blue, background);
}
