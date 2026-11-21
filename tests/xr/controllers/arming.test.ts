import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_MIN_MS,
  CONFIRM_WINDOW_MS,
  createArming,
} from '../../../src/xr/controllers/arming';

const makeDeps = () => ({
  cue: vi.fn(),
  lastSelectSource: () => null,
  disposed: () => false,
  inputRoot: () => ({}) as THREE.Group,
  inputMode: () => 'commands' as const,
  refreshInputRoot: vi.fn(),
  menuCommands: () => [{ id: 'c1', text: 'echo hi' }],
  stripCommands: () => [] as { id: string; text: string }[],
  hudRoot: () => null,
  hoveredByController: new Map<THREE.Group, THREE.Object3D>(),
  updateLabel: vi.fn(),
});

describe('arming controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms a command inside the confirm window and reports it', () => {
    const arming = createArming(makeDeps());
    arming.armCommand({ id: 'c1', action: 'run', kind: 'run' });
    expect(arming.isArmed('c1', 'run')).toBe(true);
    expect(arming.hasArmedCommand()).toBe(true);
    expect(arming.armedCommandKind()).toBe('run');
    expect(arming.confirmTooSoon()).toBe(true);
    arming.disarmCommand();
    expect(arming.hasArmedCommand()).toBe(false);
    expect(arming.disarmCommand()).toBe(false);
  });

  it('expires the armed command after the confirm window', () => {
    const deps = makeDeps();
    const arming = createArming(deps);
    arming.armCommand({ id: 'c1', action: 'run', kind: 'run' });
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS + 1);
    expect(arming.hasArmedCommand()).toBe(false);
    expect(deps.refreshInputRoot).toHaveBeenCalledWith('commands');
    expect(arming.disarmCommand()).toBe(false);
  });

  it('previews the armed command text and drops it when disarmed', () => {
    const arming = createArming(makeDeps());
    expect(arming.armedPreview('run')).toBeNull();
    arming.armCommand({ id: 'c1', action: 'run', kind: 'run' });
    expect(arming.armedPreview('run')).toContain('echo hi');
    expect(arming.armedPreview('run')).toContain('Sends');
    arming.armCommand({ id: 'c1', action: 'run', kind: 'remove' });
    expect(arming.armedPreview('run')).toContain('Removes');
    arming.disarmCommand();
    expect(arming.armedPreview('run')).toBeNull();
  });

  it('requires the minimum gap between arm and confirm', () => {
    const arming = createArmed();
    function createArmed() {
      const a = createArming(makeDeps());
      a.armCommand({ id: 'c1', action: 'run', kind: 'run' });
      return a;
    }
    expect(arming.confirmTooSoon()).toBe(true);
    vi.advanceTimersByTime(CONFIRM_MIN_MS + 1);
    expect(arming.confirmTooSoon()).toBe(false);
  });

  it('confirms a control on the second press and re-arms on the first', () => {
    const deps = makeDeps();
    const arming = createArming(deps);
    expect(arming.confirmControl('exit')).toBe(false);
    expect(arming.armedControlState()?.action).toBe('exit');
    expect(deps.cue).toHaveBeenCalledWith('armed', null);
    vi.advanceTimersByTime(CONFIRM_MIN_MS + 1);
    expect(arming.confirmControl('exit')).toBe(true);
    expect(arming.armedControlState()).toBeNull();
  });

  it('refuses a confirm pressed too soon and keeps the control armed', () => {
    const arming = createArming(makeDeps());
    arming.confirmControl('resetLayout');
    expect(arming.confirmControl('resetLayout')).toBe(false);
    expect(arming.armedControlState()?.action).toBe('resetLayout');
  });

  it('switches the armed control to a different action', () => {
    const arming = createArming(makeDeps());
    arming.confirmControl('exit');
    expect(arming.confirmControl('resetLayout')).toBe(false);
    expect(arming.armedControlState()?.action).toBe('resetLayout');
  });

  it('expires the armed control and clears it', () => {
    const arming = createArming(makeDeps());
    arming.confirmControl('exit');
    expect(arming.armedControlState()).not.toBeNull();
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS + 1);
    expect(arming.armedControlState()).toBeNull();
  });

  it('disarmPresses clears both an armed control and an armed command', () => {
    const arming = createArming(makeDeps());
    arming.confirmControl('exit');
    arming.armCommand({ id: 'c1', action: 'run', kind: 'run' });
    arming.disarmPresses();
    expect(arming.armedControlState()).toBeNull();
    expect(arming.hasArmedCommand()).toBe(false);
  });

  it('dispose clears the timers so nothing fires afterwards', () => {
    const deps = makeDeps();
    const arming = createArming(deps);
    arming.armCommand({ id: 'c1', action: 'run', kind: 'run' });
    arming.confirmControl('exit');
    arming.dispose();
    expect(arming.armedControlState()).toBeNull();
    expect(arming.hasArmedCommand()).toBe(false);
    const callsAtDispose = vi.mocked(deps.refreshInputRoot).mock.calls.length;
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS * 2);
    expect(vi.mocked(deps.refreshInputRoot).mock.calls.length).toBe(callsAtDispose);
  });
});
