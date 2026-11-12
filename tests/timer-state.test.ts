import { describe, expect, it } from 'vitest';
import {
  createTimerState,
  DEFAULT_COUNTDOWN_MS,
  DONE_FLASH_MS,
  displayMs,
  displaySeconds,
  doneAtMs,
  flashActive,
  formatSeconds,
  readout,
  reset,
  selectPreset,
  setMode,
  statusAt,
  tick,
  toggleMode,
  toggleRun,
} from '../src/xr/timer-state';

const T0 = 1_000_000;

describe('timer state machine', () => {
  it('starts as an idle 5 minute countdown with an idle stopwatch', () => {
    const state = createTimerState();
    expect(state.mode).toBe('countdown');
    expect(state.countdown).toMatchObject({ status: 'idle', durationMs: DEFAULT_COUNTDOWN_MS });
    expect(state.stopwatch).toMatchObject({ status: 'idle', accumulatedMs: 0 });
    expect(readout(state, T0)).toMatchObject({ text: '5:00', status: 'idle', flash: false });
  });

  describe('countdown', () => {
    it('counts down from the start time and ceilings the displayed second', () => {
      const state = toggleRun(createTimerState(), T0);
      expect(statusAt(state, T0)).toBe('running');
      expect(readout(state, T0).text).toBe('5:00');
      expect(readout(state, T0 + 1).text).toBe('5:00');
      expect(readout(state, T0 + 1000).text).toBe('4:59');
      expect(readout(state, T0 + 299_001).text).toBe('0:01');
    });

    it('is based on nowMs, so a long frame gap lands on the right value', () => {
      const state = toggleRun(createTimerState(), T0);
      expect(displayMs(state, T0 + 123_456)).toBe(DEFAULT_COUNTDOWN_MS - 123_456);
    });

    it('pauses without losing time and resumes from the banked remainder', () => {
      let state = toggleRun(createTimerState(), T0);
      state = toggleRun(state, T0 + 60_000);
      expect(statusAt(state, T0 + 60_000)).toBe('paused');
      expect(displayMs(state, T0 + 60_000)).toBe(240_000);
      expect(displayMs(state, T0 + 600_000)).toBe(240_000);
      state = toggleRun(state, T0 + 600_000);
      expect(displayMs(state, T0 + 630_000)).toBe(210_000);
    });

    it('finishes exactly at the due time and reports Done with a flash', () => {
      const state = toggleRun(createTimerState(), T0);
      const due = T0 + DEFAULT_COUNTDOWN_MS;
      expect(statusAt(state, due - 1)).toBe('running');
      expect(statusAt(state, due)).toBe('done');
      expect(readout(state, due)).toMatchObject({ text: 'Done', status: 'done', flash: true });
      expect(displayMs(state, due + 99_999)).toBe(0);
    });

    it('stamps the done time at the due instant even when the first tick is late', () => {
      const state = tick(toggleRun(createTimerState(), T0), T0 + DEFAULT_COUNTDOWN_MS + 3000);
      expect(state.countdown.status).toBe('done');
      expect(doneAtMs(state, T0 + 10 * 60_000)).toBe(T0 + DEFAULT_COUNTDOWN_MS);
    });

    it('keeps the flash for DONE_FLASH_MS after the due time, then stops while staying Done', () => {
      const state = tick(toggleRun(createTimerState(), T0), T0 + DEFAULT_COUNTDOWN_MS);
      const due = T0 + DEFAULT_COUNTDOWN_MS;
      expect(flashActive(state, due + DONE_FLASH_MS - 1)).toBe(true);
      expect(flashActive(state, due + DONE_FLASH_MS)).toBe(false);
      expect(readout(state, due + DONE_FLASH_MS + 1).text).toBe('Done');
    });

    it('counts a pause into the due time', () => {
      let state = toggleRun(createTimerState(), T0);
      state = toggleRun(state, T0 + 100_000);
      state = toggleRun(state, T0 + 500_000);
      expect(statusAt(state, T0 + 500_000 + 199_999)).toBe('running');
      expect(statusAt(state, T0 + 500_000 + 200_000)).toBe('done');
    });

    it('restarts a done countdown from the full duration on start', () => {
      let state = toggleRun(createTimerState(), T0);
      const later = T0 + DEFAULT_COUNTDOWN_MS + 5000;
      state = toggleRun(state, later);
      expect(statusAt(state, later)).toBe('running');
      expect(displayMs(state, later)).toBe(DEFAULT_COUNTDOWN_MS);
      expect(flashActive(state, later)).toBe(false);
    });

    it('presses Start after the due time and restarts rather than pausing a stale run', () => {
      const state = toggleRun(toggleRun(createTimerState(), T0), T0 + DEFAULT_COUNTDOWN_MS + 1);
      expect(statusAt(state, T0 + DEFAULT_COUNTDOWN_MS + 1)).toBe('running');
    });

    it('resets to idle at the full duration from running, paused and done', () => {
      const running = toggleRun(createTimerState(), T0);
      for (const state of [
        running,
        toggleRun(running, T0 + 1000),
        tick(running, T0 + DEFAULT_COUNTDOWN_MS),
      ]) {
        const cleared = reset(state);
        expect(cleared.countdown.status).toBe('idle');
        expect(displayMs(cleared, T0 + 10 * 60_000)).toBe(DEFAULT_COUNTDOWN_MS);
        expect(flashActive(cleared, T0 + DEFAULT_COUNTDOWN_MS)).toBe(false);
      }
    });

    it('presets set the length and return to idle', () => {
      let state = createTimerState();
      for (const minutes of [1, 5, 15, 25]) {
        state = selectPreset(state, minutes);
        expect(state.countdown.status).toBe('idle');
        expect(readout(state, T0 + 5000).text).toBe(`${minutes}:00`);
        expect(state.countdown.durationMs).toBe(minutes * 60_000);
      }
      expect(readout(state, T0).text).toBe('25:00');
    });

    it('ignores a preset while the countdown runs, and accepts it once paused', () => {
      const running = toggleRun(createTimerState(), T0);
      expect(selectPreset(running, 25)).toBe(running);
      const paused = toggleRun(running, T0 + 1000);
      expect(selectPreset(paused, 25).countdown).toMatchObject({
        status: 'idle',
        durationMs: 25 * 60_000,
      });
    });

    it('a preset pressed after a countdown finished clears Done', () => {
      let state = tick(toggleRun(createTimerState(), T0), T0 + DEFAULT_COUNTDOWN_MS);
      state = selectPreset(state, 1);
      expect(readout(state, T0 + DEFAULT_COUNTDOWN_MS + 1)).toMatchObject({
        text: '1:00',
        status: 'idle',
        flash: false,
      });
    });

    it('ignores invalid preset values', () => {
      const state = createTimerState();
      expect(selectPreset(state, 0)).toBe(state);
      expect(selectPreset(state, -3)).toBe(state);
      expect(selectPreset(state, Number.NaN)).toBe(state);
    });

    it('clamps a clock that runs backwards to the start value', () => {
      const state = toggleRun(createTimerState(), T0);
      expect(displayMs(state, T0 - 5000)).toBe(DEFAULT_COUNTDOWN_MS);
    });
  });

  describe('stopwatch', () => {
    const stopwatch = () => toggleMode(createTimerState(), T0);

    it('counts up, floors the displayed second and has no done state', () => {
      const state = toggleRun(stopwatch(), T0);
      expect(readout(state, T0)).toMatchObject({ text: '0:00', status: 'running' });
      expect(readout(state, T0 + 999).text).toBe('0:00');
      expect(readout(state, T0 + 1000).text).toBe('0:01');
      expect(readout(state, T0 + 10 * 3600_000).status).toBe('running');
      expect(readout(state, T0 + 3_725_000).text).toBe('1:02:05');
    });

    it('pauses, holds, resumes and resets', () => {
      let state = toggleRun(stopwatch(), T0);
      state = toggleRun(state, T0 + 5000);
      expect(statusAt(state, T0 + 9000)).toBe('paused');
      expect(displaySeconds(state, T0 + 60_000)).toBe(5);
      state = toggleRun(state, T0 + 60_000);
      expect(displaySeconds(state, T0 + 63_000)).toBe(8);
      state = reset(state);
      expect(readout(state, T0 + 70_000)).toMatchObject({ text: '0:00', status: 'idle' });
    });

    it('ignores presets', () => {
      const state = stopwatch();
      expect(selectPreset(state, 15)).toBe(state);
    });
  });

  describe('switching modes', () => {
    it('keeps separate state for each mode', () => {
      let state = selectPreset(createTimerState(), 15);
      state = toggleRun(state, T0);
      state = toggleMode(state, T0 + 1);
      expect(state.mode).toBe('stopwatch');
      expect(statusAt(state, T0 + 1000)).toBe('idle');
      state = toggleRun(state, T0 + 10_000);
      state = toggleMode(state, T0 + 20_000);
      expect(readout(state, T0 + 30_000)).toMatchObject({ text: '14:30', status: 'running' });
      state = toggleMode(state, T0 + 30_000);
      expect(readout(state, T0 + 30_000)).toMatchObject({ text: '0:20', status: 'running' });
    });

    it('shows a badge, not a flash, when a countdown finishes under the stopwatch', () => {
      let state = selectPreset(createTimerState(), 1);
      state = toggleRun(state, T0);
      state = setMode(state, 'stopwatch', T0 + 1000);
      const due = T0 + 60_000;
      expect(readout(state, due - 1)).toMatchObject({ status: 'idle', doneBadge: false });
      expect(readout(state, due)).toMatchObject({ status: 'idle', flash: false, doneBadge: true });
      expect(readout(state, due + 60_000).text).toBe('0:00');
    });

    it('flashes for the full window starting when the finished countdown is shown again', () => {
      let state = selectPreset(createTimerState(), 1);
      state = toggleRun(state, T0);
      state = setMode(state, 'stopwatch', T0 + 1000);
      const back = T0 + 90_000;
      state = setMode(state, 'countdown', back);
      expect(readout(state, back)).toMatchObject({ text: 'Done', flash: true, doneBadge: false });
      expect(flashActive(state, back + DONE_FLASH_MS - 1)).toBe(true);
      expect(flashActive(state, back + DONE_FLASH_MS)).toBe(false);
      // Leaving and returning does not re-arm the flash.
      state = setMode(setMode(state, 'stopwatch', back + 10_000), 'countdown', back + 20_000);
      expect(flashActive(state, back + 20_000)).toBe(false);
    });

    it('returns the same object for a no-op mode change', () => {
      const state = createTimerState();
      expect(setMode(state, 'countdown', T0)).toBe(state);
    });

    it('reset only touches the active mode', () => {
      let state = toggleRun(createTimerState(), T0);
      state = toggleMode(state, T0);
      state = toggleRun(state, T0);
      state = reset(state);
      state = toggleMode(state, T0);
      expect(statusAt(state, T0 + 1000)).toBe('running');
    });
  });

  it('does not mutate the input state', () => {
    const state = createTimerState();
    const snapshot = JSON.stringify(state);
    toggleRun(state, T0);
    reset(state);
    toggleMode(state, T0);
    selectPreset(state, 1);
    tick(state, T0);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('tick returns the same object when nothing changes', () => {
    const idle = createTimerState();
    expect(tick(idle, T0)).toBe(idle);
    const running = toggleRun(idle, T0);
    expect(tick(running, T0 + 1000)).toBe(running);
  });

  it('formats seconds as m:ss and h:mm:ss', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(59)).toBe('0:59');
    expect(formatSeconds(60)).toBe('1:00');
    expect(formatSeconds(1500)).toBe('25:00');
    expect(formatSeconds(3600)).toBe('1:00:00');
    expect(formatSeconds(-4)).toBe('0:00');
  });
});
