import type * as THREE from 'three';

export const FOVEATION_LEVELS = { high: 1, medium: 0.5, low: 0.25, off: 0 } as const;
export type FoveationLevel = keyof typeof FOVEATION_LEVELS;

export interface XrSessionOptions {
  /** Defaults to 'immersive-vr'. */
  mode?: XRSessionMode;
  /** Tried in order until the session accepts one. Defaults to ['local-floor', 'local']. */
  referenceSpaces?: readonly XRReferenceSpaceType[];
  /** Defaults to ['hand-tracking']. Every entry of `referenceSpaces` is added as well. */
  optionalFeatures?: readonly string[];
  /** Defaults to 'medium'. */
  foveation?: FoveationLevel | number;
  onStart?(session: XRSession): void;
  onEnd?(): void;
  /** The reference space was reset, for example by the headset's recenter. */
  onReset?(): void;
  /** For tests. Defaults to `navigator.xr`. */
  xr?: XRSystem;
}

export interface XrSession {
  supported(): Promise<boolean>;
  /** Resolves once the session is presenting. Rejects if the request is refused. */
  enter(): Promise<void>;
  exit(): Promise<void>;
  readonly session: XRSession | null;
  readonly reference: XRReferenceSpace | null;
  readonly presenting: boolean;
  /** 0 to 1. */
  readonly foveation: number;
  setFoveation(level: FoveationLevel | number): void;
  /** Call once per frame. Asserts the foveation level and returns the viewer pose, if any. */
  update(frame?: XRFrame): XRViewerPose | null;
  dispose(): void;
}

function resolveFoveation(level: FoveationLevel | number): number {
  const value = typeof level === 'number' ? level : FOVEATION_LEVELS[level];
  return Math.min(1, Math.max(0, value));
}

export function createXrSession(
  renderer: THREE.WebGLRenderer,
  options: XrSessionOptions = {},
): XrSession {
  const {
    mode = 'immersive-vr',
    referenceSpaces = ['local-floor', 'local'],
    optionalFeatures = ['hand-tracking'],
  } = options;
  let foveation = resolveFoveation(options.foveation ?? 'medium');
  let active: XRSession | null = null;
  let reference: XRReferenceSpace | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  let onResetListener: (() => void) | null = null;
  let detachEnd: (() => void) | null = null;

  const system = (): XRSystem | undefined =>
    options.xr ?? (typeof navigator === 'undefined' ? undefined : navigator.xr);

  function release(): void {
    if (reference && onResetListener) reference.removeEventListener('reset', onResetListener);
    onResetListener = null;
    active = null;
    reference = null;
  }

  async function start(xr: XRSystem): Promise<void> {
    const session = await xr.requestSession(mode, {
      optionalFeatures: [...referenceSpaces, ...optionalFeatures],
    });
    let ended = false;
    const onEnd = (): void => {
      ended = true;
      detachEnd = null;
      if (active === session) release();
      options.onEnd?.();
    };
    session.addEventListener('end', onEnd, { once: true });
    detachEnd = () => session.removeEventListener('end', onEnd);
    try {
      let chosen: XRReferenceSpaceType | null = null;
      for (const type of referenceSpaces) {
        try {
          await session.requestReferenceSpace(type);
          chosen = type;
          break;
        } catch {}
      }
      if (!chosen) throw new Error('No supported XR reference space');
      renderer.xr.setReferenceSpaceType(chosen);
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);
    } catch (error) {
      if (!ended) await session.end().catch(() => {});
      throw error;
    }
    if (ended || disposed) {
      if (!ended) await session.end().catch(() => {});
      return;
    }
    active = session;
    reference = renderer.xr.getReferenceSpace();
    if (reference) {
      onResetListener = () => options.onReset?.();
      reference.addEventListener('reset', onResetListener);
    }
    renderer.xr.setFoveation(foveation);
    options.onStart?.(session);
  }

  return {
    async supported() {
      const xr = system();
      if (!xr) return false;
      try {
        return await xr.isSessionSupported(mode);
      } catch {
        return false;
      }
    },
    enter() {
      if (disposed || active) return Promise.resolve();
      if (pending) return pending;
      const xr = system();
      if (!xr) return Promise.reject(new Error('WebXR is unavailable'));
      pending = start(xr).finally(() => {
        pending = null;
      });
      return pending;
    },
    async exit() {
      try {
        await active?.end();
      } catch {}
    },
    get session() {
      return active;
    },
    get reference() {
      return reference;
    },
    get presenting() {
      return active !== null;
    },
    get foveation() {
      return foveation;
    },
    setFoveation(level) {
      if (disposed) return;
      foveation = resolveFoveation(level);
      if (active) renderer.xr.setFoveation(foveation);
    },
    update(frame) {
      if (disposed || !active || !frame || !reference) return null;
      renderer.xr.setFoveation(foveation);
      return frame.getViewerPose(reference) ?? null;
    },
    dispose() {
      if (disposed) return;
      if (reference && onResetListener) reference.removeEventListener('reset', onResetListener);
      onResetListener = null;
      detachEnd?.();
      detachEnd = null;
      disposed = true;
    },
  };
}
