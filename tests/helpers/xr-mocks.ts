/**
 * Module-mock factories and shared state for the XR scene tests. vi.mock is hoisted per test
 * file, so a helper cannot install a mock for its importer: every test file keeps its own
 * `vi.mock(...)` lines and reaches these factories through a dynamic import in the factory body.
 * This file must not import `three` at runtime, because it is loaded while `three` is mocked.
 */
import { vi } from 'vitest';

export const fakeXR = {
  controllers: [] as unknown[],
  hands: [] as unknown[],
  presenting: false,
  camera: null as unknown,
  frame: null as ((time: number, frame?: unknown) => void) | null,
};

export const handPoses = { count: 0, probeReads: 0 };
export const focusedDirectories = { git: vi.fn(), kanban: vi.fn() };

/** `three` with a renderer that needs no GL context and exposes the fake XR controllers. */
export function createThreeMock(actual: typeof import('three')): typeof import('three') {
  fakeXR.controllers = [new actual.Group(), new actual.Group()];
  fakeXR.hands = [new actual.Group(), new actual.Group()];
  class FakeRenderer {
    xr = {
      enabled: false,
      get isPresenting() {
        return fakeXR.presenting;
      },
      getController: (index: number) => fakeXR.controllers[index],
      getHand: (index: number) => fakeXR.hands[index],
      getCamera: () => fakeXR.camera,
      setReferenceSpaceType: vi.fn(),
      getReferenceSpace: () => ({}),
      setSession: vi.fn(async () => undefined),
    };
    capabilities = { getMaxAnisotropy: () => 1 };
    setPixelRatio(_ratio: number): void {}
    setSize(_width: number, _height: number, _updateStyle?: boolean): void {}
    autoClear = true;
    clearDepth(): void {}
    setAnimationLoop(callback: ((time: number) => void) | null): void {
      fakeXR.frame = callback;
    }
    render(scene: { updateMatrixWorld(force?: boolean): void }): void {
      scene.updateMatrixWorld(true);
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer } as unknown as typeof import('three');
}

/** The repo-status widget with its focused-pane hook routed to `focusedDirectories.git`. */
export function withSpiedRepoStatus(
  actual: typeof import('../../src/xr/repo-status-widget'),
): typeof import('../../src/xr/repo-status-widget') {
  return {
    ...actual,
    createRepoStatusWidget: (...args: Parameters<typeof actual.createRepoStatusWidget>) => ({
      ...actual.createRepoStatusWidget(...args),
      setFocusedPane: focusedDirectories.git,
    }),
  };
}

/** The kanban strip with its focused-pane hook routed to `focusedDirectories.kanban`. */
export function withSpiedKanbanStrip(
  actual: typeof import('../../src/xr/kanban-strip'),
): typeof import('../../src/xr/kanban-strip') {
  return {
    ...actual,
    createKanbanStripWidget: (...args: Parameters<typeof actual.createKanbanStripWidget>) => ({
      ...actual.createKanbanStripWidget(...args),
      setFocusedPane: focusedDirectories.kanban,
    }),
  };
}

/**
 * `@par/xr-workspace` with the test label helpers and a standard hand whose pose updates and
 * contact-probe reads are counted in `handPoses`.
 */
export async function withLabelsAndCountingHand(
  actual: typeof import('@par/xr-workspace'),
): Promise<typeof import('@par/xr-workspace')> {
  const { createCartoonHand } = actual;
  return {
    ...actual,
    ...(await import('./labels')),
    // A cartoon hand lacks StandardHand.assetReady, which these scenes never read.
    createStandardHand: ((...args: Parameters<typeof createCartoonHand>) => {
      const hand = createCartoonHand(...args);
      const update = hand.update.bind(hand);
      hand.update = (...pose: Parameters<typeof hand.update>) => {
        handPoses.count++;
        update(...pose);
      };
      const probes = hand.contactProbes;
      return Object.defineProperty(hand, 'contactProbes', {
        get: () => {
          handPoses.probeReads++;
          return probes;
        },
      });
    }) as unknown as typeof actual.createStandardHand,
  };
}
