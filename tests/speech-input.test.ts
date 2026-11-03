import { describe, expect, it, vi } from 'vitest';
import { createSpeechInput, type DictationState } from '../src/speech-input';

type FakeRecognition = {
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

const installRecognition = (prefixed = false): FakeRecognition => {
  const instance: FakeRecognition = {
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const Constructor = vi.fn(function TestSpeechRecognition() {
    return instance;
  });
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  delete scope.SpeechRecognition;
  delete scope.webkitSpeechRecognition;
  if (prefixed) scope.webkitSpeechRecognition = Constructor;
  else scope.SpeechRecognition = Constructor;
  return instance;
};

const result = (text: string, isFinal: boolean, index = 0): unknown => ({
  resultIndex: index,
  results: { length: 1, [index]: { isFinal, length: 1, 0: { transcript: text } } },
});

describe('speech input', () => {
  it('preserves a startup error against callbacks from the failed recognizer', () => {
    const recognition = installRecognition();
    const stale = {
      result: null as FakeRecognition['onresult'],
      end: null as FakeRecognition['onend'],
    };
    recognition.start.mockImplementation(() => {
      stale.result = recognition.onresult;
      stale.end = recognition.onend;
      throw new Error('start failed');
    });
    const input = createSpeechInput({
      onState: () => undefined,
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: () => true,
    });
    input.dispatch('start');
    stale.result?.(result('late', true));
    stale.end?.();
    expect(input.getState()).toMatchObject({
      status: 'error',
      transcript: '',
      error: 'Speech recognition could not start.',
    });
    expect(recognition.abort).toHaveBeenCalledOnce();
    input.dispose();
  });

  it('ignores actions and draft edits after disposal', () => {
    const recognition = installRecognition();
    const onState = vi.fn();
    const input = createSpeechInput({
      onState,
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: () => true,
    });
    input.dispatch('start');
    recognition.onresult?.(result('keep', true));
    recognition.onend?.();
    input.dispose();
    const count = onState.mock.calls.length;
    input.dispatch('cancel');
    input.dispatch('start');
    input.editDraft('late');
    expect(onState).toHaveBeenCalledTimes(count);
  });
  it('feature-detects standard and prefixed recognition', () => {
    installRecognition();
    expect(
      createSpeechInput({
        onState: () => undefined,
        getTargetPaneId: () => 'p',
        canInsert: () => true,
        onInsert: () => true,
      }).getState().supported,
    ).toBe(true);
    installRecognition(true);
    expect(
      createSpeechInput({
        onState: () => undefined,
        getTargetPaneId: () => 'p',
        canInsert: () => true,
        onInsert: () => true,
      }).getState().supported,
    ).toBe(true);
  });

  it('keeps final and interim transcript for explicit review and insertion without Enter', () => {
    const recognition = installRecognition();
    const states: DictationState[] = [];
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: (state) => states.push(state),
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: insert,
    });
    input.dispatch('start');
    recognition.onstart?.();
    recognition.onresult?.(result('hello\nworld', false));
    recognition.onresult?.(result('hello\nworld', true));
    recognition.onresult?.(result('hello\nworld', true));
    recognition.onend?.();
    expect(input.getState()).toMatchObject({ status: 'review', transcript: 'hello\nworld' });
    input.dispatch('insert');
    expect(insert).toHaveBeenCalledWith('p', 'hello world');
    expect(input.getState().status).toBe('idle');
    expect(states.some((state) => state.status === 'review')).toBe(true);
  });

  it('invalidates stale callbacks on cancel and rejects retargeted insertion', () => {
    const recognition = installRecognition();
    let target: string | null = 'p';
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: () => undefined,
      getTargetPaneId: () => target,
      canInsert: () => true,
      onInsert: insert,
    });
    input.dispatch('start');
    input.dispatch('cancel');
    recognition.onresult?.(result('late', true));
    expect(input.getState().transcript).toBe('');
    input.dispatch('start');
    recognition.onresult?.(result('keep', true));
    recognition.onend?.();
    target = 'other';
    input.dispatch('insert');
    expect(insert).not.toHaveBeenCalled();
    expect(input.getState().status).toBe('error');
  });

  it('preserves reviewed shell spacing while replacing Enter characters', () => {
    const recognition = installRecognition();
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: () => undefined,
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: insert,
    });
    input.dispatch('start');
    recognition.onresult?.(result('echo', true));
    recognition.onend?.();
    input.editDraft(" echo 'a  b' \r\nnext ");
    input.dispatch('insert');
    expect(insert).toHaveBeenCalledWith('p', " echo 'a  b'  next ");
    input.dispose();
  });

  it('stops without auto-inserting and surfaces permission errors', () => {
    const recognition = installRecognition();
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: () => undefined,
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: insert,
    });
    input.dispatch('start');
    input.dispatch('stop');
    expect(recognition.stop).toHaveBeenCalledOnce();
    recognition.onerror?.({ error: 'not-allowed' });
    recognition.onend?.();
    recognition.onresult?.(result('late', true));
    expect(input.getState().error).toContain('permission');
    expect(insert).not.toHaveBeenCalled();
  });
});
