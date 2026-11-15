import { createXrSession, type XrSessionOptions } from '@par/xr-workspace';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

class FakeSession extends EventTarget {
  rejectSpaces = new Set<string>();
  readonly requested: string[] = [];
  readonly space = new EventTarget() as unknown as XRReferenceSpace;
  requestReferenceSpace = vi.fn(async (type: string) => {
    this.requested.push(type);
    if (this.rejectSpaces.has(type)) throw new Error(`no ${type}`);
    return this.space;
  });
  end = vi.fn(async () => {
    this.dispatchEvent(new Event('end'));
  });
}

function setup(options: { rejectSpaces?: string[]; xrOptions?: XrSessionOptions } = {}) {
  const session = new FakeSession();
  for (const type of options.rejectSpaces ?? []) session.rejectSpaces.add(type);
  const requestSession = vi.fn(async (_mode: string, _init?: XRSessionInit) => session);
  const xr = {
    isSessionSupported: vi.fn(async () => true),
    requestSession,
  } as unknown as XRSystem;
  const setSessionGate: { release?: () => void; gate?: Promise<void> } = {};
  const renderer = {
    xr: {
      enabled: false,
      isPresenting: false,
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(async () => {
        await setSessionGate.gate;
      }),
      getReferenceSpace: vi.fn(() => session.space),
      setFoveation: vi.fn(),
    },
  };
  const handlers = { onStart: vi.fn(), onEnd: vi.fn(), onReset: vi.fn() };
  const helper = createXrSession(renderer as unknown as THREE.WebGLRenderer, {
    xr,
    ...handlers,
    ...options.xrOptions,
  });
  return { session, xr, requestSession, renderer, handlers, helper, setSessionGate };
}

const frame = (pose: unknown) => ({ getViewerPose: vi.fn(() => pose) }) as unknown as XRFrame;

describe('supported', () => {
  it('reflects isSessionSupported', async () => {
    const { helper, xr } = setup();
    expect(await helper.supported()).toBe(true);
    vi.mocked(xr.isSessionSupported).mockResolvedValue(false);
    expect(await helper.supported()).toBe(false);
  });

  it('is false without xr and when the query rejects', async () => {
    const renderer = {} as THREE.WebGLRenderer;
    expect(await createXrSession(renderer, { xr: undefined }).supported()).toBe(false);
    const xr = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('x')),
    } as unknown as XRSystem;
    expect(await createXrSession(renderer, { xr }).supported()).toBe(false);
  });
});

describe('enter', () => {
  it('requests the mode with merged optional features and applies the reference space', async () => {
    const { helper, requestSession, renderer, handlers, session } = setup();
    await helper.enter();
    expect(requestSession).toHaveBeenCalledWith('immersive-vr', {
      optionalFeatures: ['local-floor', 'local', 'hand-tracking'],
    });
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
    expect(renderer.xr.enabled).toBe(true);
    expect(helper.presenting).toBe(true);
    expect(helper.session).toBe(session);
    expect(helper.reference).toBe(session.space);
    expect(handlers.onStart).toHaveBeenCalledWith(session);
  });

  it('falls back to local when local-floor rejects', async () => {
    const { helper, renderer, session } = setup({ rejectSpaces: ['local-floor'] });
    await helper.enter();
    expect(session.requested).toEqual(['local-floor', 'local']);
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledTimes(1);
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local');
  });

  it('ends the session and rejects when no reference space resolves', async () => {
    const { helper, session, handlers } = setup({ rejectSpaces: ['local-floor', 'local'] });
    await expect(helper.enter()).rejects.toThrow();
    expect(session.end).toHaveBeenCalled();
    expect(helper.presenting).toBe(false);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('honours mode, reference spaces and optional features', async () => {
    const { helper, requestSession } = setup({
      xrOptions: {
        mode: 'immersive-ar',
        referenceSpaces: ['local'],
        optionalFeatures: ['anchors'],
      },
    });
    await helper.enter();
    expect(requestSession).toHaveBeenCalledWith('immersive-ar', {
      optionalFeatures: ['local', 'anchors'],
    });
  });

  it('shares one request between overlapping calls and resolves at once when presenting', async () => {
    const { helper, requestSession } = setup();
    await Promise.all([helper.enter(), helper.enter()]);
    expect(requestSession).toHaveBeenCalledTimes(1);
    await helper.enter();
    expect(requestSession).toHaveBeenCalledTimes(1);
  });

  it('stays out of presenting and skips onStart when the session ends during setSession', async () => {
    const { helper, handlers, session, renderer, setSessionGate } = setup();
    let release: () => void = () => {};
    setSessionGate.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entering = helper.enter();
    await vi.waitFor(() => expect(renderer.xr.setSession).toHaveBeenCalled());
    session.dispatchEvent(new Event('end'));
    release();
    await entering;
    expect(helper.presenting).toBe(false);
    expect(helper.session).toBeNull();
    expect(handlers.onStart).not.toHaveBeenCalled();
  });
});

describe('foveation', () => {
  it('defaults to 0.5 and applies on enter', async () => {
    const { helper, renderer } = setup();
    expect(helper.foveation).toBe(0.5);
    await helper.enter();
    expect(renderer.xr.setFoveation).toHaveBeenLastCalledWith(0.5);
  });

  it('accepts an initial level and clamps numbers', () => {
    expect(setup({ xrOptions: { foveation: 'high' } }).helper.foveation).toBe(1);
    const { helper } = setup();
    helper.setFoveation(3);
    expect(helper.foveation).toBe(1);
    helper.setFoveation(-1);
    expect(helper.foveation).toBe(0);
  });

  it('is asserted by every update and follows setFoveation', async () => {
    const { helper, renderer } = setup();
    await helper.enter();
    renderer.xr.setFoveation.mockClear();
    helper.update(frame(null));
    helper.update(frame(null));
    expect(renderer.xr.setFoveation.mock.calls).toEqual([[0.5], [0.5]]);
    helper.setFoveation('off');
    expect(renderer.xr.setFoveation).toHaveBeenLastCalledWith(0);
    helper.update(frame(null));
    expect(renderer.xr.setFoveation).toHaveBeenLastCalledWith(0);
    helper.setFoveation(0.25);
    expect(helper.foveation).toBe(0.25);
    helper.update(frame(null));
    expect(renderer.xr.setFoveation).toHaveBeenLastCalledWith(0.25);
  });

  it('does not touch the renderer before presenting', () => {
    const { helper, renderer } = setup();
    helper.setFoveation('low');
    expect(renderer.xr.setFoveation).not.toHaveBeenCalled();
    expect(helper.foveation).toBe(0.25);
  });
});

describe('update', () => {
  it('returns null before entering and the frame pose afterwards', async () => {
    const { helper } = setup();
    expect(helper.update(frame({}))).toBeNull();
    await helper.enter();
    const pose = { transform: {} };
    expect(helper.update(frame(pose))).toBe(pose);
    expect(helper.update(frame(undefined))).toBeNull();
    expect(helper.update()).toBeNull();
  });
});

describe('session events', () => {
  it('clears state and calls onEnd when the session ends', async () => {
    const { helper, handlers, session } = setup();
    await helper.enter();
    await helper.exit();
    expect(session.end).toHaveBeenCalled();
    expect(helper.session).toBeNull();
    expect(helper.reference).toBeNull();
    expect(helper.presenting).toBe(false);
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onReset for reference-space reset events until the session ends', async () => {
    const { helper, handlers, session } = setup();
    await helper.enter();
    session.space.dispatchEvent(new Event('reset'));
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
    session.dispatchEvent(new Event('end'));
    session.space.dispatchEvent(new Event('reset'));
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from exiting an already ended session', async () => {
    const { helper, session } = setup();
    await helper.enter();
    session.end.mockRejectedValueOnce(new Error('ended'));
    await expect(helper.exit()).resolves.toBeUndefined();
  });

  it('dispose detaches listeners and turns later calls into no-ops', async () => {
    const { helper, handlers, session, requestSession } = setup();
    await helper.enter();
    helper.dispose();
    session.space.dispatchEvent(new Event('reset'));
    session.dispatchEvent(new Event('end'));
    expect(handlers.onReset).not.toHaveBeenCalled();
    expect(handlers.onEnd).not.toHaveBeenCalled();
    await helper.enter();
    expect(requestSession).toHaveBeenCalledTimes(1);
    expect(helper.update(frame({}))).toBeNull();
  });
});
