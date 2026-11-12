import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    anchorX: number | string = 0;
    textAlign = '';
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import {
  AGENT_BOARD_HEIGHT,
  AGENT_BOARD_WIDTH,
  createAgentBoardWidget,
} from '../src/xr/agent-board';
import { createPerfGaugeWidget, PERF_GAUGE_HEIGHT, PERF_GAUGE_WIDTH } from '../src/xr/perf-gauge';
import {
  createRepoStatusWidget,
  REPO_STATUS_HEIGHT,
  REPO_STATUS_WIDTH,
} from '../src/xr/repo-status-widget';
import { createTimerWidget, TIMER_HEIGHT, TIMER_WIDTH } from '../src/xr/timer-widget';
import { createClockWidget } from '../src/xr/widgets';

const CASES = [
  ['digital clock', () => createClockWidget('digital-clock'), 'clock-close', 0.62, 0.24],
  ['analog clock', () => createClockWidget('analog-clock'), 'clock-close', 0.58, 0.58],
  ['timer', () => createTimerWidget(), 'timer-close', TIMER_WIDTH, TIMER_HEIGHT],
  [
    'repo status',
    () => createRepoStatusWidget(null, { fetchStatus: () => new Promise(() => undefined) }),
    'repo-status-close',
    REPO_STATUS_WIDTH,
    REPO_STATUS_HEIGHT,
  ],
  [
    'agent board',
    () => createAgentBoardWidget(),
    'agent-board-close',
    AGENT_BOARD_WIDTH,
    AGENT_BOARD_HEIGHT,
  ],
  [
    'perf gauge',
    () => createPerfGaugeWidget(),
    'perf-gauge-close',
    PERF_GAUGE_WIDTH,
    PERF_GAUGE_HEIGHT,
  ],
] as const;

describe('widget close buttons', () => {
  it.each(CASES)(
    'sits flush in the top-right corner of the %s backing',
    (_, create, name, width, height) => {
      const widget = create();
      const close = widget.root.getObjectByName(name) as THREE.Mesh;
      const { width: size } = (close.geometry as THREE.PlaneGeometry).parameters;
      const scale = close.scale.x;
      expect(close.position.x + (size * scale) / 2).toBeCloseTo(width / 2, 6);
      expect(close.position.y + (size * scale) / 2).toBeCloseTo(height / 2, 6);
      widget.dispose();
    },
  );
});
