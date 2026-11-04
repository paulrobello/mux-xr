export interface ClipboardBridge {
  copy(text: string): Promise<boolean>;
  read(): Promise<string | null>;
  dispose(): void;
}

export interface ClipboardProvider {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
}

export interface ClipboardBridgeOptions {
  timeoutMs?: number;
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
  let cachedText: string | null = null;
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

  const copy = (text: string): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    const currentGeneration = ++generation;
    cachedText = text;
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

  const read = (): Promise<string | null> => {
    if (disposed) return Promise.resolve(null);
    const snapshotGeneration = generation;
    const snapshotText = cachedText;
    const clipboard = currentProvider();
    if (snapshotText !== null && writeState !== 'confirmed') return Promise.resolve(snapshotText);
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
    writeState = 'failed';
  };

  return { copy, read, dispose };
}
