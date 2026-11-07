import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUIFeedback, pulseGamepad, type UICue } from '../src/xr/ui-feedback';

class FakeParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeContext {
  static created = 0;
  state: AudioContextState = 'suspended';
  currentTime = 1;
  destination = {};
  oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => undefined);
  constructor() {
    FakeContext.created += 1;
  }
  createOscillator() {
    const oscillator = {
      type: 'sine',
      frequency: new FakeParam(),
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    return { gain: new FakeParam(), connect: vi.fn() };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeContext.created = 0;
});

describe('UI feedback', () => {
  it('is a silent no-op without WebAudio', () => {
    vi.stubGlobal('AudioContext', undefined);
    const feedback = createUIFeedback();
    expect(() => feedback.play('select')).not.toThrow();
    feedback.dispose();
  });

  it('creates the audio context lazily, resumes it and plays short envelopes', () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const feedback = createUIFeedback();
    expect(FakeContext.created).toBe(0);
    const cues: UICue[] = [
      'select',
      'grab',
      'release',
      'tick',
      'lock',
      'armed',
      'error',
      'recenter',
    ];
    for (const cue of cues) feedback.play(cue);
    expect(FakeContext.created).toBe(1);
    feedback.dispose();
  });

  it('keeps every cue between 30 and 80 ms and resumes a suspended context', () => {
    let instance: FakeContext | null = null;
    const feedback = createUIFeedback({
      createContext: () => {
        instance = new FakeContext();
        return instance as unknown as AudioContext;
      },
    });
    feedback.play('error');
    const context = instance as unknown as FakeContext;
    expect(context.resume).toHaveBeenCalledOnce();
    feedback.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    const cues: UICue[] = [
      'select',
      'grab',
      'release',
      'tick',
      'lock',
      'armed',
      'error',
      'recenter',
    ];
    for (const cue of cues) {
      let tones: FakeContext | null = null;
      const player = createUIFeedback({
        createContext: () => {
          tones = new FakeContext();
          return tones as unknown as AudioContext;
        },
      });
      player.play(cue);
      const { oscillators } = tones as unknown as FakeContext;
      const start = Math.min(...oscillators.map((tone) => tone.start.mock.calls[0][0] as number));
      // Each oscillator stops 10 ms after its envelope ends to avoid a click.
      const end =
        Math.max(...oscillators.map((tone) => tone.stop.mock.calls[0][0] as number)) - 0.01;
      expect(end - start, cue).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(end - start, cue).toBeLessThanOrEqual(0.08 + 1e-9);
      player.dispose();
    }
  });

  it('rate-limits strip ticks to one per 40 ms', () => {
    let time = 0;
    const pulse = vi.fn();
    const gamepad = { hapticActuators: [{ pulse }] } as unknown as Gamepad;
    const feedback = createUIFeedback({ now: () => time, createContext: () => null });
    feedback.play('tick', gamepad);
    time = 20;
    feedback.play('tick', gamepad);
    time = 41;
    feedback.play('tick', gamepad);
    expect(pulse).toHaveBeenCalledTimes(2);
    feedback.play('select', gamepad);
    expect(pulse).toHaveBeenCalledTimes(3);
  });

  it('pulses the first haptic actuator and falls back to the vibration actuator', () => {
    const pulse = vi.fn(async () => true);
    pulseGamepad({ hapticActuators: [{ pulse }] } as unknown as Gamepad, 0.5, 30);
    expect(pulse).toHaveBeenCalledWith(0.5, 30);
    const playEffect = vi.fn(async () => 'complete');
    pulseGamepad({ vibrationActuator: { playEffect } } as unknown as Gamepad, 0.4, 20);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 20,
      strongMagnitude: 0.4,
      weakMagnitude: 0.4,
    });
    expect(() => pulseGamepad({} as Gamepad, 1, 10)).not.toThrow();
    expect(() => pulseGamepad(undefined, 1, 10)).not.toThrow();
  });
});
