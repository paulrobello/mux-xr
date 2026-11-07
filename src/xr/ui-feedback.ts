// Short synthesized UI cues plus matching controller pulses. Sounds are WebAudio envelopes, never
// files, so the module stays silent (and harmless) wherever AudioContext is missing.
export type UICue =
  | 'select'
  | 'grab'
  | 'release'
  | 'tick'
  | 'lock'
  | 'armed'
  | 'error'
  | 'recenter';

export interface UIFeedback {
  /** Play a cue, pulsing `gamepad` when one is given. Hands pass none and get sound only. */
  play(cue: UICue, gamepad?: Gamepad | null): void;
  dispose(): void;
}

interface Tone {
  from: number;
  to: number;
  seconds: number;
  gain: number;
  type: OscillatorType;
  delay?: number;
}

const TONES: Record<UICue, Tone[]> = {
  select: [{ from: 1250, to: 1050, seconds: 0.035, gain: 0.06, type: 'sine' }],
  grab: [{ from: 420, to: 640, seconds: 0.06, gain: 0.08, type: 'triangle' }],
  release: [{ from: 640, to: 400, seconds: 0.06, gain: 0.07, type: 'triangle' }],
  tick: [{ from: 2400, to: 2200, seconds: 0.03, gain: 0.025, type: 'sine' }],
  lock: [
    { from: 880, to: 880, seconds: 0.035, gain: 0.06, type: 'sine' },
    { from: 1320, to: 1320, seconds: 0.04, gain: 0.06, type: 'sine', delay: 0.035 },
  ],
  armed: [
    { from: 700, to: 700, seconds: 0.035, gain: 0.07, type: 'triangle' },
    { from: 700, to: 700, seconds: 0.035, gain: 0.07, type: 'triangle', delay: 0.045 },
  ],
  error: [{ from: 240, to: 170, seconds: 0.08, gain: 0.07, type: 'square' }],
  recenter: [{ from: 440, to: 900, seconds: 0.08, gain: 0.07, type: 'sine' }],
};

/** Pulse intensity (0..1) and length in milliseconds for each cue. */
const HAPTICS: Record<UICue, [number, number]> = {
  select: [0.3, 15],
  grab: [0.5, 30],
  release: [0.3, 20],
  tick: [0.15, 8],
  lock: [0.6, 40],
  armed: [0.5, 40],
  error: [0.8, 60],
  recenter: [0.6, 50],
};

export const TICK_INTERVAL_MS = 40;

interface HapticGamepad {
  hapticActuators?: ArrayLike<{ pulse?(value: number, duration: number): unknown }>;
  vibrationActuator?: {
    playEffect?(type: string, params: Record<string, number>): unknown;
  } | null;
}

function quietly(result: unknown): void {
  if (result && typeof (result as Promise<unknown>).catch === 'function')
    (result as Promise<unknown>).catch(() => undefined);
}

export function pulseGamepad(
  gamepad: Gamepad | null | undefined,
  intensity: number,
  ms: number,
): void {
  const pad = gamepad as (Gamepad & HapticGamepad) | null | undefined;
  if (!pad) return;
  try {
    const actuator = pad.hapticActuators?.[0];
    if (actuator?.pulse) {
      quietly(actuator.pulse(intensity, ms));
      return;
    }
    if (pad.vibrationActuator?.playEffect)
      quietly(
        pad.vibrationActuator.playEffect('dual-rumble', {
          duration: ms,
          strongMagnitude: intensity,
          weakMagnitude: intensity,
        }),
      );
  } catch {
    // Haptics are best effort; an actuator that throws must not break input handling.
  }
}

function defaultContext(): AudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  return Context ? new Context() : null;
}

export function createUIFeedback(
  options: { now?: () => number; createContext?: () => AudioContext | null } = {},
): UIFeedback {
  const now = options.now ?? (() => performance.now());
  const createContext = options.createContext ?? defaultContext;
  let context: AudioContext | null = null;
  let unavailable = false;
  let lastTick = Number.NEGATIVE_INFINITY;
  const audio = (): AudioContext | null => {
    if (context || unavailable) return context;
    try {
      context = createContext();
    } catch {
      context = null;
    }
    unavailable = !context;
    return context;
  };
  return {
    play(cue, gamepad) {
      if (cue === 'tick') {
        const time = now();
        if (time - lastTick < TICK_INTERVAL_MS) return;
        lastTick = time;
      }
      const [intensity, ms] = HAPTICS[cue];
      pulseGamepad(gamepad, intensity, ms);
      const ctx = audio();
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') quietly(ctx.resume());
        for (const tone of TONES[cue]) {
          const start = ctx.currentTime + (tone.delay ?? 0);
          const end = start + tone.seconds;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = tone.type;
          oscillator.frequency.setValueAtTime(tone.from, start);
          oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(tone.gain, start + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(end + 0.01);
        }
      } catch {
        // A closed or interrupted audio context only loses the sound.
      }
    },
    dispose() {
      const ctx = context;
      context = null;
      unavailable = true;
      if (ctx) quietly(ctx.close());
    },
  };
}
