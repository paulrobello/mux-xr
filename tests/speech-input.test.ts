import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechInput,
  type DictationState,
  type SpeechRecognitionLike,
} from '../src/speech-input';

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
  it('dictates a note without a target pane, then refuses to insert it anywhere', () => {
    const recognition = installRecognition();
    const states: DictationState[] = [];
    const onInsert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: (state) => states.push(state),
      getTargetPaneId: () => null,
      canInsert: () => false,
      onInsert,
    });
    input.dispatch('start');
    expect(states.at(-1)?.status).toBe('error');
    expect(recognition.start).not.toHaveBeenCalled();
    input.dispatch('startNote');
    expect(recognition.start).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ status: 'listening', forNote: true });
    recognition.onresult?.(result('Check the desk lamp', true));
    recognition.onend?.();
    input.dispatch('insert');
    expect(states.at(-1)).toMatchObject({
      status: 'review',
      transcript: 'Check the desk lamp',
      error: null,
      forNote: true,
    });
    expect(onInsert).not.toHaveBeenCalled();
    input.dispose();
  });
  it('prefers an explicitly configured recognizer over the browser speech service', () => {
    const native = installRecognition();
    const local: SpeechRecognitionLike = {
      ...native,
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };
    const input = createSpeechInput({
      recognitionFactory: () => local,
      onState: () => undefined,
      getTargetPaneId: () => 'pane',
      canInsert: () => true,
      onInsert: () => true,
    });
    input.dispatch('start');
    expect(local.start).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
    input.dispose();
  });
  it('keeps local transcription pending beyond the browser recognizer stop timeout', () => {
    vi.useFakeTimers();
    const recognition = installRecognition() as unknown as SpeechRecognitionLike;
    const scope = globalThis as typeof globalThis & {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    delete scope.SpeechRecognition;
    delete scope.webkitSpeechRecognition;
    Object.defineProperty(recognition, 'responseTimeoutMs', { value: 90_000 });
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      recognitionFactory: () => recognition,
      onState: () => undefined,
      getTargetPaneId: () => 'pane',
      canInsert: () => true,
      onInsert: insert,
    });
    try {
      input.dispatch('start');
      input.dispatch('stop');
      recognition.onprocessing?.();
      vi.advanceTimersByTime(1_500);
      expect(input.getState().status).toBe('transcribing');
      expect(insert).not.toHaveBeenCalled();
      recognition.onresult?.(result('local text', true) as never);
      recognition.onend?.();
      expect(input.getState().status).toBe('review');
      input.dispatch('insert');
      expect(insert).toHaveBeenCalledExactlyOnceWith('pane', 'local text');
    } finally {
      input.dispose();
      vi.useRealTimers();
    }
  });
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

  it('clears reviewed text without cancelling and keeps the original target for later insertion', () => {
    const recognition = installRecognition();
    let target: string | null = 'original';
    const insert = vi.fn(() => true);
    const input = createSpeechInput({
      onState: () => undefined,
      getTargetPaneId: () => target,
      canInsert: () => true,
      onInsert: insert,
    });
    input.dispatch('start');
    recognition.onresult?.(result('first draft', true));
    input.dispatch('clear');
    expect(input.getState()).toMatchObject({ status: 'listening', transcript: 'first draft' });
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(recognition.abort).not.toHaveBeenCalled();
    recognition.onend?.();
    expect(input.getState().status).toBe('review');
    input.dispatch('clear');
    expect(input.getState()).toMatchObject({ status: 'review', transcript: '' });
    input.editDraft('replacement text');
    target = 'other';
    input.dispatch('insert');
    expect(insert).not.toHaveBeenCalled();
    target = 'original';
    input.dispatch('insert');
    expect(insert).toHaveBeenCalledExactlyOnceWith('original', 'replacement text');
  });

  it('ignores clear while transcribing', () => {
    const recognition = installRecognition() as unknown as SpeechRecognitionLike;
    const input = createSpeechInput({
      recognitionFactory: () => recognition,
      onState: () => undefined,
      getTargetPaneId: () => 'p',
      canInsert: () => true,
      onInsert: () => true,
    });
    input.dispatch('start');
    recognition.onprocessing?.();
    input.dispatch('clear');
    expect(input.getState().status).toBe('transcribing');
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(recognition.abort).not.toHaveBeenCalled();
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
