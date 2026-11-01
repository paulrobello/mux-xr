export interface UpdateManifest {
  buildId: string;
  version?: string;
}

export interface UpdateCheckerOptions {
  runningBuildId: string;
  url: string;
  onChange: (manifest: UpdateManifest | null) => void;
  intervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface UpdateChecker {
  start: () => void;
  poll: () => Promise<void>;
  dispose: () => void;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BUILD_ID_LENGTH = 256;

const parseManifest = (value: unknown): UpdateManifest | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as { buildId?: unknown; version?: unknown };
  if (typeof candidate.buildId !== 'string') return null;
  const buildId = candidate.buildId.trim();
  if (buildId.length === 0 || buildId.length > MAX_BUILD_ID_LENGTH) return null;
  if (candidate.version !== undefined && typeof candidate.version !== 'string') return null;
  return candidate.version === undefined ? { buildId } : { buildId, version: candidate.version };
};

const sameManifest = (left: UpdateManifest | null, right: UpdateManifest | null): boolean =>
  left?.buildId === right?.buildId && left?.version === right?.version;

export const createUpdateChecker = ({
  runningBuildId,
  url,
  onChange,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImpl = globalThis.fetch,
}: UpdateCheckerOptions): UpdateChecker => {
  let disposed = false;
  let started = false;
  let intervalHandle: ReturnType<typeof setInterval> | undefined;
  let requestController: AbortController | undefined;
  let inFlight: Promise<void> | null = null;
  let currentNotice: UpdateManifest | null = null;

  const poll = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight;

    const operation = (async () => {
      const controller = new AbortController();
      requestController = controller;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetchImpl(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (disposed || !response.ok) return;
        const manifest = parseManifest(await response.json());
        if (disposed || manifest === null) return;
        const nextNotice = manifest.buildId === runningBuildId ? null : manifest;
        if (!sameManifest(currentNotice, nextNotice)) {
          currentNotice = nextNotice;
          onChange(nextNotice);
        }
      } catch {
        // Network, timeout, abort, and malformed response failures retain the current notice.
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (requestController === controller) requestController = undefined;
      }
    })();
    let wrappedOperation: Promise<void>;
    wrappedOperation = operation.finally(() => {
      if (inFlight === wrappedOperation) inFlight = null;
    });
    inFlight = wrappedOperation;
    return wrappedOperation;
  };

  const start = (): void => {
    if (disposed || started) return;
    started = true;
    void poll();
    intervalHandle = setInterval(() => void poll(), intervalMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (intervalHandle !== undefined) clearInterval(intervalHandle);
    requestController?.abort();
    requestController = undefined;
  };

  return { start, poll, dispose };
};
