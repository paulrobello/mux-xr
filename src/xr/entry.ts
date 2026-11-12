export type XrEntryMode = 'vr' | 'ar';

interface XrSystemLike {
  isSessionSupported?: (mode: 'immersive-vr') => Promise<boolean>;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
}

interface XrEntryEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface XrEntryControllerOptions {
  enter: (mode: XrEntryMode) => Promise<void>;
  isActive: () => boolean;
  onError: (error: unknown) => void;
  onActivationRequired?: () => void;
  xr?: XrSystemLike;
  eventTarget?: XrEntryEventTarget;
  userActivation?: () => boolean;
}

export interface XrEntryController {
  start(mode: XrEntryMode, automatic?: boolean): Promise<void>;
  enableAutoStart(): Promise<void>;
  /** True while the first-gesture fallback listeners are waiting to enter XR. */
  isFallbackArmed(): boolean;
  dispose(): void;
}

const ACTIVATION_ERROR_NAMES = new Set(['NotAllowedError', 'SecurityError']);
const ACTIVATION_ERROR_PATTERN = /user.?activation|not allowed|security|permission/i;

function isExpectedAutomaticError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ACTIVATION_ERROR_NAMES.has(error.name) || ACTIVATION_ERROR_PATTERN.test(error.message);
}

export function createXREntryController(options: XrEntryControllerOptions): XrEntryController {
  const target = options.eventTarget;
  let disposed = false;
  let autoEnabled = false;
  let autoFallbackArmed = false;
  let inFlight: Promise<void> | null = null;

  let onActivation: EventListener | null = null;
  let onSessionGranted: EventListener | null = null;

  const removeFallbackListeners = (): void => {
    if (target && onActivation) {
      target.removeEventListener('pointerup', onActivation);
      target.removeEventListener('keydown', onActivation);
    }
    if (onSessionGranted) options.xr?.removeEventListener?.('sessiongranted', onSessionGranted);
    onActivation = null;
    onSessionGranted = null;
    autoFallbackArmed = false;
  };

  const armFallback = (): void => {
    if (disposed || !autoEnabled || autoFallbackArmed || (!target && !options.xr?.addEventListener))
      return;
    autoFallbackArmed = true;
    onActivation = (event) => {
      const eventTarget = event.target;
      if (
        typeof Element !== 'undefined' &&
        eventTarget instanceof Element &&
        eventTarget.closest('[data-action="xr"],[data-action="passthrough"]')
      ) {
        removeFallbackListeners();
        return;
      }
      if (options.userActivation && !options.userActivation()) return;
      void start('vr', true).catch(() => undefined);
    };
    onSessionGranted = () => {
      void start('vr', true).catch(() => undefined);
    };
    target?.addEventListener('pointerup', onActivation);
    target?.addEventListener('keydown', onActivation);
    options.xr?.addEventListener?.('sessiongranted', onSessionGranted);
  };

  const start = (mode: XrEntryMode, automatic = false): Promise<void> => {
    if (disposed || options.isActive()) return Promise.resolve();
    if (!automatic) {
      autoEnabled = false;
      removeFallbackListeners();
    }
    if (inFlight) return inFlight;

    const attempt = options
      .enter(mode)
      .then(() => {
        if (automatic) removeFallbackListeners();
      })
      .catch((error: unknown) => {
        if (disposed || options.isActive()) return;
        if (automatic && isExpectedAutomaticError(error)) {
          armFallback();
          options.onActivationRequired?.();
          return;
        }
        removeFallbackListeners();
        options.onError(error);
        throw error;
      });
    let settled: Promise<void>;
    settled = attempt.finally(() => {
      if (inFlight === settled) inFlight = null;
    });
    inFlight = settled;
    return settled;
  };

  const enableAutoStart = async (): Promise<void> => {
    if (disposed || autoEnabled) return;
    autoEnabled = true;
    const supported = await options.xr?.isSessionSupported?.('immersive-vr');
    if (disposed || !autoEnabled || supported !== true) return;
    await start('vr', true);
  };

  return {
    start,
    enableAutoStart,
    isFallbackArmed: () => autoFallbackArmed,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      autoEnabled = false;
      removeFallbackListeners();
    },
  };
}
