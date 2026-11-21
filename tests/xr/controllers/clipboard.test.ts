import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClipboardDeps, createClipboard } from '../../../src/xr/controllers/clipboard';

const makePanel = () => ({
  id: 'p1',
  surface: {
    status: 'connected' as const,
    paste: vi.fn(() => true),
  },
});

const makeDeps = () => {
  const panel = makePanel();
  const panels = new Map<string, ReturnType<typeof makePanel>>([['p1', panel]]);
  return {
    panel,
    deps: {
      bridge: {
        read: vi.fn(async () => 'plain text'),
        copy: vi.fn(async () => true),
      },
      actions: {},
      mutableState: {
        pastePrompt: null,
        notice: null,
        pasteReview: 'multiline',
        inputTargetId: 'p1',
        selectedTerminalId: 'p1',
      },
      panels,
      availablePanes: [{ id: 'p1', title: 'Pane one' }],
      cue: vi.fn(),
      setNotice: vi.fn(),
      showToast: vi.fn(),
      notify: vi.fn(),
      disposed: () => false,
      lastSelectSource: () => null,
      inputRoot: () => null,
      inputMode: () => 'terminal' as const,
      refreshInputRoot: vi.fn(),
      getPictureUrl: () => ({ text: '', cursor: 0 }),
      setPictureUrl: vi.fn(),
      getPicturePanelMessage: () => '',
      setPicturePanelMessage: vi.fn(),
      pictureUrlPasteToken: '\u0000picture-url',
    } as unknown as ClipboardDeps & { mutableState: Record<string, unknown> },
  };
};

describe('clipboard controller', () => {
  let harness: ReturnType<typeof makeDeps>;
  let controller: ReturnType<typeof createClipboard>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = makeDeps();
    controller = createClipboard(harness.deps);
  });

  it('pastes plain clipboard text into the selected connected panel immediately', async () => {
    const ok = await controller.pasteClipboard();
    expect(ok).toBe(true);
    expect(harness.panel.surface.paste).toHaveBeenCalledWith('plain text');
    expect(harness.deps.showToast).toHaveBeenCalledWith('Pasted.');
    expect(harness.deps.mutableState.pastePrompt).toBeNull();
  });

  it('arms a review prompt for a multiline paste and pastes on the confirming press', async () => {
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('line1\nline2');
    const first = await controller.pasteClipboard();
    expect(first).toBe(false);
    expect(harness.panel.surface.paste).not.toHaveBeenCalled();
    expect(harness.deps.mutableState.pastePrompt).toContain('Press Paste again');
    vi.advanceTimersByTime(400);
    const second = await controller.pasteClipboard();
    expect(second).toBe(true);
    expect(harness.panel.surface.paste).toHaveBeenCalledWith('line1\nline2');
    expect(harness.deps.mutableState.pastePrompt).toBeNull();
  });

  it('refuses a confirming press inside the minimum arm-to-confirm gap', async () => {
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('line1\nline2');
    await controller.pasteClipboard();
    const tooSoon = await controller.pasteClipboard();
    expect(tooSoon).toBe(false);
    expect(harness.panel.surface.paste).not.toHaveBeenCalled();
  });

  it('expires the armed paste after the confirm window and re-arms', async () => {
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('line1\nline2');
    await controller.pasteClipboard();
    vi.advanceTimersByTime(3100);
    vi.mocked(harness.deps.showToast).mockClear();
    const again = await controller.pasteClipboard();
    // After expiry the press re-arms instead of pasting.
    expect(again).toBe(false);
    expect(harness.deps.mutableState.pastePrompt).toContain('Press Paste again');
  });

  it('a superseding clipboard action drops an in-flight host paste read', async () => {
    let releaseRead: (value: string) => void = () => {};
    vi.mocked(harness.deps.bridge.read).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const pending = controller.pasteHostClipboard();
    controller.beginClipboardAction();
    releaseRead('late host text');
    const result = await pending;
    expect(result).toBe(false);
    expect(harness.panel.surface.paste).not.toHaveBeenCalled();
  });

  it('drops the armed paste for a pane when only that pane detaches', async () => {
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('line1\nline2');
    await controller.pasteClipboard();
    controller.clearArmedPasteForPane('other');
    expect(harness.deps.mutableState.pastePrompt).toContain('Press Paste again');
    controller.clearArmedPasteForPane('p1');
    expect(harness.deps.mutableState.pastePrompt).toBeNull();
  });

  it('generation queries reflect the live action counter', async () => {
    const gen = controller.beginClipboardAction();
    expect(controller.isCurrentClipboardGeneration(gen)).toBe(true);
    expect(controller.isCurrentClipboardGeneration(gen - 1)).toBe(false);
    const next = controller.beginClipboardAction();
    expect(controller.isCurrentClipboardGeneration(gen)).toBe(false);
    expect(next).toBe(gen + 1);
  });

  it('copyQuestToHost reports an empty Quest clipboard through a notice', async () => {
    harness.deps.actions.writeHostClipboard = vi.fn(async () => ({ ok: true as const, value: 0 }));
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('');
    const ok = await controller.copyQuestToHost(null);
    expect(ok).toBe(false);
    expect(harness.deps.setNotice).toHaveBeenCalledWith(expect.stringContaining('empty'));
  });

  it('dispose drops an armed paste', async () => {
    vi.mocked(harness.deps.bridge.read).mockResolvedValue('line1\nline2');
    await controller.pasteClipboard();
    controller.dispose();
    expect(harness.deps.mutableState.pastePrompt).toBeNull();
    vi.advanceTimersByTime(5000);
  });
});
