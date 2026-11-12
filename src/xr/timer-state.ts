/** Pure timer and stopwatch state machine. No rendering; every time is a caller-supplied wall-clock ms. */

export type TimerMode = 'countdown' | 'stopwatch';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export const COUNTDOWN_PRESET_MINUTES = [1, 5, 15, 25] as const;
export const DEFAULT_COUNTDOWN_MS = 5 * 60_000;
/** How long the done signal keeps flashing after a countdown reaches zero. */
export const DONE_FLASH_MS = 5000;

/**
 * One clock's state. Elapsed time is `accumulatedMs` plus `nowMs - startedAtMs` while running, so
 * it depends only on the `nowMs` handed in and survives dropped frames.
 */
export interface ClockState {
  status: TimerStatus;
  /** Wall-clock ms when the current run segment began; meaningful only while running. */
  startedAtMs: number;
  /** Elapsed ms banked by earlier run segments. */
  accumulatedMs: number;
  /** Countdown length; 0 for a stopwatch. */
  durationMs: number;
  /**
   * Wall-clock ms the done flash began: the due time when the countdown finished on screen, or
   * the moment the countdown was next shown. 0 while a finished countdown has not been seen.
   */
  flashFromMs: number;
}

export interface TimerState {
  mode: TimerMode;
  countdown: ClockState;
  stopwatch: ClockState;
}

export function createTimerState(): TimerState {
  return {
    mode: 'countdown',
    countdown: {
      status: 'idle',
      startedAtMs: 0,
      accumulatedMs: 0,
      durationMs: DEFAULT_COUNTDOWN_MS,
      flashFromMs: 0,
    },
    stopwatch: { status: 'idle', startedAtMs: 0, accumulatedMs: 0, durationMs: 0, flashFromMs: 0 },
  };
}

function elapsedOf(clock: ClockState, nowMs: number): number {
  const running = clock.status === 'running' ? Math.max(0, nowMs - clock.startedAtMs) : 0;
  const elapsed = clock.accumulatedMs + running;
  return clock.durationMs > 0 ? Math.min(elapsed, clock.durationMs) : elapsed;
}

/** Wall-clock ms at which a running countdown reaches zero. */
function dueAt(clock: ClockState): number {
  return clock.startedAtMs + (clock.durationMs - clock.accumulatedMs);
}

function active(state: TimerState): ClockState {
  return state[state.mode];
}

function withActive(state: TimerState, clock: ClockState): TimerState {
  return { ...state, [state.mode]: clock };
}

/** Moves a running countdown to done once `nowMs` reaches its due time; otherwise returns the same object. */
export function tick(state: TimerState, nowMs: number): TimerState {
  const clock = state.countdown;
  if (clock.status !== 'running' || nowMs < dueAt(clock)) return state;
  return {
    ...state,
    countdown: {
      ...clock,
      status: 'done',
      startedAtMs: dueAt(clock),
      accumulatedMs: clock.durationMs,
      // A countdown that finishes while the stopwatch is shown flashes once it is shown again.
      flashFromMs: state.mode === 'countdown' ? dueAt(clock) : 0,
    },
  };
}

/** Switches the visible mode. The other mode keeps running and keeps its own state. */
export function setMode(state: TimerState, mode: TimerMode, nowMs: number): TimerState {
  if (state.mode === mode) return state;
  const ticked = tick(state, nowMs);
  const clock = ticked.countdown;
  const unseen = mode === 'countdown' && clock.status === 'done' && clock.flashFromMs === 0;
  return {
    ...ticked,
    mode,
    countdown: unseen ? { ...clock, flashFromMs: nowMs } : clock,
  };
}

export function toggleMode(state: TimerState, nowMs: number): TimerState {
  return setMode(state, state.mode === 'countdown' ? 'stopwatch' : 'countdown', nowMs);
}

/** Start from idle or paused, pause from running, restart from done (a stopwatch is never done). */
export function toggleRun(state: TimerState, nowMs: number): TimerState {
  const ticked = tick(state, nowMs);
  const clock = active(ticked);
  switch (clock.status) {
    case 'running':
      return withActive(ticked, {
        ...clock,
        status: 'paused',
        accumulatedMs: elapsedOf(clock, nowMs),
      });
    case 'done':
      return withActive(ticked, {
        ...clock,
        status: 'running',
        startedAtMs: nowMs,
        accumulatedMs: 0,
        flashFromMs: 0,
      });
    default:
      return withActive(ticked, { ...clock, status: 'running', startedAtMs: nowMs });
  }
}

/** Back to idle at zero elapsed for the active mode, keeping the countdown length. */
export function reset(state: TimerState): TimerState {
  return withActive(state, {
    ...active(state),
    status: 'idle',
    startedAtMs: 0,
    accumulatedMs: 0,
    flashFromMs: 0,
  });
}

/**
 * Picks a countdown length in minutes and returns the countdown to idle. Ignored in stopwatch
 * mode and while the countdown runs, so a stray press never silently cancels it; pause first.
 */
export function selectPreset(state: TimerState, minutes: number): TimerState {
  if (state.mode !== 'countdown' || state.countdown.status === 'running') return state;
  if (!Number.isFinite(minutes) || minutes <= 0) return state;
  return {
    ...state,
    countdown: {
      status: 'idle',
      startedAtMs: 0,
      accumulatedMs: 0,
      durationMs: Math.round(minutes * 60_000),
      flashFromMs: 0,
    },
  };
}

/** Countdown: time left. Stopwatch: time elapsed. Always whole-clock ms, never negative. */
export function displayMs(state: TimerState, nowMs: number): number {
  const clock = active(state);
  const elapsed = elapsedOf(tick(state, nowMs)[state.mode], nowMs);
  return state.mode === 'countdown' ? Math.max(0, clock.durationMs - elapsed) : elapsed;
}

/** Whole seconds on the face: countdown rounds up so 0:00 appears only when done, stopwatch rounds down. */
export function displaySeconds(state: TimerState, nowMs: number): number {
  const ms = displayMs(state, nowMs);
  return state.mode === 'countdown' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
}

export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Effective status of the active mode at `nowMs`, including a countdown that just finished. */
export function statusAt(state: TimerState, nowMs: number): TimerStatus {
  return tick(state, nowMs)[state.mode].status;
}

/** Wall-clock ms the countdown finished, or null when it has not. */
export function doneAtMs(state: TimerState, nowMs: number): number | null {
  const clock = tick(state, nowMs).countdown;
  return clock.status === 'done' ? clock.startedAtMs : null;
}

/** True for DONE_FLASH_MS after a finished countdown is on screen; never while the stopwatch shows. */
export function flashActive(state: TimerState, nowMs: number): boolean {
  if (state.mode !== 'countdown') return false;
  const clock = tick(state, nowMs).countdown;
  return (
    clock.status === 'done' && clock.flashFromMs > 0 && nowMs - clock.flashFromMs < DONE_FLASH_MS
  );
}

export interface TimerReadout {
  mode: TimerMode;
  status: TimerStatus;
  /** Face text: mm:ss, or "Done" once the countdown is finished. */
  text: string;
  flash: boolean;
  /** A countdown has finished while the stopwatch is shown. */
  doneBadge: boolean;
}

export function readout(state: TimerState, nowMs: number): TimerReadout {
  const ticked = tick(state, nowMs);
  const status = ticked[state.mode].status;
  const text =
    state.mode === 'countdown' && status === 'done'
      ? 'Done'
      : formatSeconds(displaySeconds(ticked, nowMs));
  return {
    mode: state.mode,
    status,
    text,
    flash: flashActive(ticked, nowMs),
    doneBadge: state.mode === 'stopwatch' && ticked.countdown.status === 'done',
  };
}
