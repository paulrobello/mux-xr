const STORAGE_KEY = 'mux-xr:terminal-warp:v1';
const VERSION = 1;

interface WarpDocument {
  version: 1;
  values: Record<string, number>;
  opacity?: Record<string, number>;
}

function clampDegrees(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function clampOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(0.1, Math.min(1, value));
}

function readDocument(storage: Storage): WarpDocument {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return { version: VERSION, values: {} };
    const candidate = parsed as Partial<WarpDocument>;
    if (
      candidate.version !== VERSION ||
      typeof candidate.values !== 'object' ||
      candidate.values === null
    ) {
      return { version: VERSION, values: {} };
    }
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(candidate.values)) values[key] = clampDegrees(value);
    const opacity: Record<string, number> = {};
    if (typeof candidate.opacity === 'object' && candidate.opacity !== null) {
      for (const [key, value] of Object.entries(candidate.opacity))
        opacity[key] = clampOpacity(value);
    }
    return { version: VERSION, values, opacity };
  } catch {
    return { version: VERSION, values: {} };
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createTerminalWarpStore(storage: Storage | null = defaultStorage()): {
  get(key: string, fallback?: number): number;
  set(key: string, degrees: number): boolean;
  getOpacity(key: string, fallback?: number): number;
  setOpacity(key: string, value: number): boolean;
} {
  return {
    get(key, fallback = 0): number {
      if (!storage) return clampDegrees(fallback);
      return readDocument(storage).values[key] ?? clampDegrees(fallback);
    },
    set(key, degrees): boolean {
      if (!storage) return false;
      const document = readDocument(storage);
      document.values[key] = clampDegrees(degrees);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
    getOpacity(key, fallback = 1): number {
      if (!storage) return clampOpacity(fallback);
      return readDocument(storage).opacity?.[key] ?? clampOpacity(fallback);
    },
    setOpacity(key, value): boolean {
      if (!storage) return false;
      const document = readDocument(storage);
      document.opacity ??= {};
      document.opacity[key] = clampOpacity(value);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
  };
}
