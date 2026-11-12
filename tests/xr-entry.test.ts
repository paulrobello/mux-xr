import { describe, expect, it, vi } from 'vitest';
import { createXREntryController } from '../src/xr/entry';

function events(): EventTarget {
  return new EventTarget();
}

describe('XR entry coordinator', () => {
  it('shares one in-flight entry across concurrent callers', async () => {
    let resolve!: () => void;
    const enter = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
    });
    const first = controller.start('vr');
    const second = controller.start('ar');
    expect(first).toBe(second);
    expect(enter).toHaveBeenCalledTimes(1);
    resolve();
    await first;
  });

  it('does not call enter or report an error when already active', async () => {
    const enter = vi.fn(async () => undefined);
    const onError = vi.fn();
    const controller = createXREntryController({
      enter,
      isActive: () => true,
      onError,
    });
    await controller.start('vr');
    expect(enter).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('auto-starts VR only when support is reported', async () => {
    const enter = vi.fn(async () => undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: vi.fn(async () => false) },
    });
    await controller.enableAutoStart();
    expect(enter).not.toHaveBeenCalled();
  });

  it('retries automatic entry from a later user activation', async () => {
    const target = events();
    let activated = true;
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('request needs user activation'), { name: 'NotAllowedError' }),
      )
      .mockResolvedValueOnce(undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
      userActivation: () => activated,
    });
    await controller.enableAutoStart();
    expect(enter).toHaveBeenCalledTimes(1);
    activated = false;
    target.dispatchEvent(new Event('pointerup'));
    expect(enter).toHaveBeenCalledTimes(1);
    activated = true;
    target.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    expect(enter).toHaveBeenCalledTimes(2);
  });

  it('allows sessiongranted to trigger the automatic retry', async () => {
    const target = events();
    const xr = events();
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('activation required'), { name: 'SecurityError' }),
      )
      .mockResolvedValueOnce(undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: {
        isSessionSupported: async () => true,
        addEventListener: xr.addEventListener.bind(xr),
        removeEventListener: xr.removeEventListener.bind(xr),
      },
      eventTarget: target,
    });
    await controller.enableAutoStart();
    xr.dispatchEvent(new Event('sessiongranted'));
    await Promise.resolve();
    expect(enter).toHaveBeenCalledTimes(2);
  });

  it('retires auto fallback when a manual mode is selected', async () => {
    const target = events();
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('activation required'), { name: 'NotAllowedError' }),
      )
      .mockResolvedValue(undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
    });
    await controller.enableAutoStart();
    await controller.start('ar');
    target.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    expect(enter).toHaveBeenCalledTimes(2);
    expect(enter).toHaveBeenLastCalledWith('ar');
  });

  it('reports manual errors but suppresses expected automatic activation errors', async () => {
    const manualError = new Error('broken');
    const onError = vi.fn();
    const controller = createXREntryController({
      enter: vi.fn(async () => {
        throw manualError;
      }),
      isActive: () => false,
      onError,
    });
    await expect(controller.start('vr')).rejects.toBe(manualError);
    expect(onError).toHaveBeenCalledWith(manualError);

    const automaticError = Object.assign(new Error('user activation required'), {
      name: 'NotAllowedError',
    });
    const automaticOnError = vi.fn();
    const automatic = createXREntryController({
      enter: vi.fn(async () => {
        throw automaticError;
      }),
      isActive: () => false,
      onError: automaticOnError,
      xr: { isSessionSupported: async () => true },
    });
    await expect(automatic.enableAutoStart()).resolves.toBeUndefined();
    expect(automaticOnError).not.toHaveBeenCalled();
  });

  it('reports an already-active error when the active state is still false', async () => {
    const error = new Error('session already active');
    const onError = vi.fn();
    const controller = createXREntryController({
      enter: vi.fn(async () => {
        throw error;
      }),
      isActive: () => false,
      onError,
    });
    await expect(controller.start('vr')).rejects.toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('attempts automatic entry after reload even without fresh activation', async () => {
    const target = events();
    const enter = vi.fn(async () => undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
      userActivation: () => false,
    });
    await controller.enableAutoStart();
    expect(enter).toHaveBeenCalledOnce();
    expect(enter).toHaveBeenCalledWith('vr');
  });

  it('explains a rejected reload attempt and retries only on a fresh activation', async () => {
    const target = events();
    let activated = false;
    const enter = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Activation required', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    const blocked = vi.fn();
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      onActivationRequired: blocked,
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
      userActivation: () => activated,
    });
    await controller.enableAutoStart();
    expect(enter).toHaveBeenCalledOnce();
    expect(blocked).toHaveBeenCalledOnce();
    target.dispatchEvent(new Event('pointerup'));
    expect(enter).toHaveBeenCalledOnce();
    activated = true;
    target.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    expect(enter).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('removes fallback listeners and ignores pending callbacks after dispose', async () => {
    const target = events();
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('activation required'), { name: 'NotAllowedError' }),
      )
      .mockResolvedValue(undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
    });
    await controller.enableAutoStart();
    controller.dispose();
    target.dispatchEvent(new Event('pointerup'));
    target.dispatchEvent(new Event('sessiongranted'));
    await Promise.resolve();
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('reports whether the first-gesture fallback is armed', async () => {
    const target = events();
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('needs activation'), { name: 'NotAllowedError' }),
      )
      .mockResolvedValueOnce(undefined);
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError: vi.fn(),
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
    });
    expect(controller.isFallbackArmed()).toBe(false);
    await controller.enableAutoStart();
    expect(controller.isFallbackArmed()).toBe(true);
    target.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.isFallbackArmed()).toBe(false);
  });

  it('disarms the fallback when entry fails with a non-activation error', async () => {
    const target = events();
    const enter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('needs activation'), { name: 'NotAllowedError' }),
      )
      .mockRejectedValueOnce(new Error('renderer exploded'));
    const onError = vi.fn();
    const controller = createXREntryController({
      enter,
      isActive: () => false,
      onError,
      xr: { isSessionSupported: async () => true },
      eventTarget: target,
    });
    await controller.enableAutoStart();
    expect(controller.isFallbackArmed()).toBe(true);
    target.dispatchEvent(new Event('keydown'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(controller.isFallbackArmed()).toBe(false);
  });
});
