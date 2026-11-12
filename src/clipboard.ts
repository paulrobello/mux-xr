export interface ClipboardCopyOptions {
  /**
   * Host clipboard text: if the system write fails, the local copy serves only the next read, for at
   * most {@link HOST_TEXT_TTL_MS}, and never a read that excludes host text.
   */
  fromHost?: boolean;
}

export interface ClipboardReadOptions {
  /** Ignore locally kept host text, so it is never sent back to the host. */
  excludeHost?: boolean;
  /**
   * Return the latest Mux XR copy (a terminal selection) without asking the system clipboard. Quest
   * Browser can resolve a write and then read back older contents inside an immersive session.
   */
  preferLocal?: boolean;
}

export const HOST_TEXT_TTL_MS = 60_000;

export interface ClipboardBridge {
  copy(text: string, options?: ClipboardCopyOptions): Promise<boolean>;
  read(options?: ClipboardReadOptions): Promise<string | null>;
  dispose(): void;
}

export interface ClipboardProvider {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
}

export interface ClipboardBridgeOptions {
  timeoutMs?: number;
  now?: () => number;
}

function defaultProvider(): ClipboardProvider | undefined {
  try {
    const scope = globalThis as typeof globalThis & {
      navigator?: { clipboard?: ClipboardProvider };
    };
    return scope.navigator?.clipboard;
  } catch {
    return undefined;
  }
}

export function createClipboardBridge(
  provider?: () => ClipboardProvider | undefined,
  options: ClipboardBridgeOptions = {},
): ClipboardBridge {
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? Date.now;
  let cachedText: string | null = null;
  let cachedFromHost = false;
  let cachedAt = 0;
  let writeState: 'pending' | 'confirmed' | 'failed' = 'failed';
  let generation = 0;
  let disposed = false;

  const currentProvider = (): ClipboardProvider | undefined => {
    try {
      return provider ? provider() : defaultProvider();
    } catch {
      return undefined;
    }
  };

  const copy = (text: string, copyOptions: ClipboardCopyOptions = {}): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    const currentGeneration = ++generation;
    cachedText = text;
    cachedFromHost = Boolean(copyOptions.fromHost);
    cachedAt = now();
    writeState = 'pending';

    const clipboard = currentProvider();
    if (!clipboard?.writeText) {
      writeState = 'failed';
      return Promise.resolve(false);
    }

    let writeResult: Promise<void>;
    try {
      // Keep the method call synchronous so browsers retain the caller's user gesture.
      writeResult = clipboard.writeText(text);
    } catch {
      writeState = 'failed';
      return Promise.resolve(false);
    }

    return Promise.resolve(writeResult).then(
      () => {
        if (!disposed && currentGeneration === generation) writeState = 'confirmed';
        return true;
      },
      () => {
        if (!disposed && currentGeneration === generation) writeState = 'failed';
        return false;
      },
    );
  };

  const read = (readOptions: ClipboardReadOptions = {}): Promise<string | null> => {
    if (disposed) return Promise.resolve(null);
    if (readOptions.preferLocal && !cachedFromHost && cachedText !== null) {
      return Promise.resolve(cachedText);
    }
    if (
      cachedFromHost &&
      writeState !== 'confirmed' &&
      cachedText !== null &&
      (readOptions.excludeHost || now() - cachedAt > HOST_TEXT_TTL_MS)
    ) {
      if (!readOptions.excludeHost) cachedText = null;
      return readSystem(null);
    }
    const snapshotText = cachedText;
    if (snapshotText !== null && writeState !== 'confirmed') {
      if (cachedFromHost) cachedText = null;
      return Promise.resolve(snapshotText);
    }
    const hostUsable =
      !cachedFromHost || (!readOptions.excludeHost && now() - cachedAt <= HOST_TEXT_TTL_MS);
    return readSystem(hostUsable ? snapshotText : null);
  };

  const readSystem = (snapshotText: string | null): Promise<string | null> => {
    const snapshotGeneration = generation;
    const clipboard = currentProvider();
    if (!clipboard?.readText) return Promise.resolve(snapshotText);

    let readResult: Promise<string>;
    try {
      // Keep the receiver intact for browser Clipboard implementations.
      readResult = clipboard.readText();
    } catch {
      return Promise.resolve(snapshotText);
    }

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(disposed ? null : snapshotText), timeoutMs);
      Promise.resolve(readResult).then(
        (value) => {
          if (settled) return;
          if (disposed) finish(null);
          else if (snapshotGeneration !== generation) finish(snapshotText);
          else finish(typeof value === 'string' ? value : snapshotText);
        },
        () => finish(disposed ? null : snapshotText),
      );
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    cachedText = null;
    cachedFromHost = false;
    writeState = 'failed';
  };

  return { copy, read, dispose };
}
