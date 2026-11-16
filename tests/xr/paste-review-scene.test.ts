import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import { fixture } from '../helpers/xr-harness';

const TWO_LINES = 'line1\nline2';

describe('paste review two-press flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const arm = (result: ReturnType<typeof fixture>, text: string) => {
    const read = vi.fn(async () => ({ ok: true as const, value: text }));
    result.actions.readHostClipboard = read;
    result.left.paste = vi.fn(() => true);
    result.right.paste = vi.fn(() => true);
    return read;
  };

  it('sends a single-line paste on the first press', async () => {
    const result = fixture();
    const read = arm(result, 'single line');
    const sent = await result.workspace.pasteHostClipboard('pane-a');
    expect(sent).toBe(true);
    expect(result.left.paste).toHaveBeenCalledTimes(1);
    expect(result.left.paste).toHaveBeenCalledWith('single line');
    expect(result.workspace.state.pastePrompt).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on the first press and the reviewed text on the second', async () => {
    const result = fixture();
    const read = arm(result, TWO_LINES);
    const first = await result.workspace.pasteHostClipboard('pane-a');
    expect(first).toBe(false);
    expect(result.left.paste).not.toHaveBeenCalled();
    expect(result.workspace.state.pastePrompt).toContain('2 lines');
    expect(result.workspace.state.pastePrompt).toContain('First line: line1');
    vi.advanceTimersByTime(400);
    const second = await result.workspace.pasteHostClipboard('pane-a');
    expect(second).toBe(true);
    expect(result.left.paste).toHaveBeenCalledTimes(1);
    expect(result.left.paste).toHaveBeenCalledWith(TWO_LINES);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.workspace.state.pastePrompt).toBeNull();
  });

  it('swallows a second press before the minimum confirm delay', async () => {
    const result = fixture();
    const read = arm(result, TWO_LINES);
    await result.workspace.pasteHostClipboard('pane-a');
    vi.advanceTimersByTime(100);
    const tooSoon = await result.workspace.pasteHostClipboard('pane-a');
    expect(tooSoon).toBe(false);
    expect(result.left.paste).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.workspace.state.pastePrompt).not.toBeNull();
    vi.advanceTimersByTime(300);
    const later = await result.workspace.pasteHostClipboard('pane-a');
    expect(later).toBe(true);
    expect(result.left.paste).toHaveBeenCalledTimes(1);
  });

  it('drops the prompt when the confirm window expires', async () => {
    const result = fixture();
    const read = arm(result, TWO_LINES);
    await result.workspace.pasteHostClipboard('pane-a');
    vi.advanceTimersByTime(3000);
    expect(result.workspace.state.pastePrompt).toBeNull();
    const after = await result.workspace.pasteHostClipboard('pane-a');
    expect(after).toBe(false);
    expect(result.left.paste).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when the selected pane changes between presses', async () => {
    const result = fixture();
    const read = arm(result, TWO_LINES);
    await result.workspace.pasteHostClipboard('pane-a');
    result.workspace.selectTerminal('pane-b');
    expect(result.workspace.state.pastePrompt).toBeNull();
    vi.advanceTimersByTime(400);
    const second = await result.workspace.pasteHostClipboard('pane-a');
    expect(second).toBe(false);
    expect(result.left.paste).not.toHaveBeenCalled();
    expect(result.right.paste).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('shows the prompt with the target pane title and removed count', async () => {
    const result = fixture();
    arm(result, 'a\u001bb\nsecond');
    await result.workspace.pasteHostClipboard('pane-a');
    const prompt = result.workspace.state.pastePrompt ?? '';
    expect(prompt).toContain('to A?');
    expect(prompt).toContain('2 lines');
    expect(prompt).toContain('1 control character removed');
    expect(prompt).toContain('First line: ab');
  });
});
