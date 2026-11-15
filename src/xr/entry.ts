/** How an XR session starts: full VR, passthrough (`ar`), or VR around a passthrough desk window. */
export type XrEntryMode = 'vr' | 'ar' | 'desk';

/** Button labels for each entry mode, shared by the browser page and the XR scene. */
export const XR_ENTRY_LABELS: Record<XrEntryMode, string> = {
  vr: 'Enter VR',
  ar: 'Enter passthrough',
  desk: 'Enter with desk window',
};

interface XrSystemLike {
  isSessionSupported?: (mode: 'immersive-vr') => Promise<boolean>;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
}

interface XrEntryEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/** Dependencies of `createXREntryController`, injected so entry can be tested without a headset. */
export interface XrEntryControllerOptions {
  /** Requests the XR session. A rejection from an automatic start that needs activation is expected. */
  enter: (mode: XrEntryMode) => Promise<void>;
  /** True while a session is already running, which makes `start` a no-op. */
  isActive: () => boolean;
  /** Called for a failure that is not an expected missing-activation refusal. */
  onError: (error: unknown) => void;
  /** Called when an automatic start was refused for lack of user activation, after the fallback arms. */
  onActivationRequired?: () => void;
  xr?: XrSystemLike;
  /** Where the first-gesture fallback listens for `pointerup` and `keydown`. */
  eventTarget?: XrEntryEventTarget;
  /** Reports whether the page has user activation. A gesture without it is ignored. */
  userActivation?: () => boolean;
}

/** Starts XR on request, and optionally on load with a first-gesture fallback. */
export interface XrEntryController {
  /**
   * Enters XR. A manual call cancels automatic entry, and a call while another attempt is in
   * flight returns that attempt. An `automatic` refusal for lack of activation arms the fallback
   * instead of failing.
   */
  start(mode: XrEntryMode, automatic?: boolean): Promise<void>;
  /** Enters VR on load when the browser supports it, falling back to the first user gesture. */
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

/** Creates the XR entry controller. `dispose` removes every listener it added. */
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
      if (typeof Element !== 'undefined' && eventTarget instanceof Element) {
        if (
          eventTarget.closest(
            '[data-action="xr"],[data-action="passthrough"],[data-action="desk-window"]',
          )
        ) {
          removeFallbackListeners();
          return;
        }
        if (eventTarget.closest('[data-action="settings"],[data-settings]')) return;
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
