export type DictationStatus = 'idle' | 'listening' | 'transcribing' | 'review' | 'error';
/** `startNote` dictates a sticky note, so it needs no target pane; its text is pinned, not inserted. */
export type DictationAction = 'start' | 'startNote' | 'stop' | 'cancel' | 'clear' | 'insert';

export interface DictationState {
  supported: boolean;
  status: DictationStatus;
  transcript: string;
  error: string | null;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onprocessing?: (() => void) | null;
  readonly responseTimeoutMs?: number;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

export interface SpeechInputOptions {
  onState(state: DictationState): void;
  getTargetPaneId(): string | null;
  canInsert(targetPaneId: string): boolean;
  onInsert(targetPaneId: string, text: string): boolean;
  timeoutMs?: number;
  recognitionFactory?: () => SpeechRecognitionLike;
}

export interface SpeechInput {
  dispatch(action: DictationAction): void;
  editDraft(text: string): void;
  getState(): DictationState;
  dispose(): void;
}

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone permission was denied.';
    case 'service-not-allowed':
      return 'This browser speech service is unavailable.';
    case 'network':
      return 'Speech recognition could not reach its service.';
    case 'no-speech':
      return 'No speech was detected.';
    case 'audio-capture':
      return 'No microphone is available.';
    default:
      return `Speech recognition failed (${code}).`;
  }
}

export function createSpeechInput(options: SpeechInputOptions): SpeechInput {
  const Constructor = recognitionConstructor();
  const createRecognition =
    options.recognitionFactory ?? (Constructor ? () => new Constructor() : undefined);
  let state: DictationState = {
    supported: Boolean(createRecognition),
    status: 'idle',
    transcript: '',
    error: createRecognition ? null : 'Speech recognition is not supported in this browser.',
  };
  let recognition: SpeechRecognitionLike | undefined;
  let targetPaneId: string | null = null;
  let generation = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopTimeout: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let committedTranscript = '';
  const seenFinalResults = new Set<string>();

  const publish = (next: Partial<DictationState>): void => {
    state = { ...state, ...next };
    options.onState({ ...state });
  };
  const clearTimeoutHandle = (): void => {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    if (stopTimeout !== undefined) clearTimeout(stopTimeout);
    stopTimeout = undefined;
  };
  const invalidate = (): number => {
    generation += 1;
    clearTimeoutHandle();
    return generation;
  };
  const detach = (instance: SpeechRecognitionLike): void => {
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    instance.onstart = null;
    instance.onprocessing = null;
  };
  const stopRecognition = (abort: boolean): void => {
    const instance = recognition;
    recognition = undefined;
    if (!instance) return;
    detach(instance);
    try {
      if (abort) instance.abort();
      else instance.stop();
    } catch {
      // Recognition may already have ended.
    }
  };
  const start = (forNote = false): void => {
    if (!createRecognition || disposed || ['listening', 'transcribing'].includes(state.status))
      return;
    const currentGeneration = invalidate();
    targetPaneId = forNote ? null : options.getTargetPaneId();
    if (!forNote && (!targetPaneId || !options.canInsert(targetPaneId))) {
      publish({
        status: 'error',
        transcript: '',
        error: 'Select a connected pane before dictating.',
      });
      return;
    }
    let instance: SpeechRecognitionLike;
    try {
      instance = createRecognition();
    } catch {
      publish({ status: 'error', transcript: '', error: 'Speech recognition could not start.' });
      return;
    }
    recognition = instance;
    committedTranscript = '';
    seenFinalResults.clear();
    publish({ status: 'listening', transcript: '', error: null });
    instance.lang = 'en-US';
    instance.interimResults = true;
    instance.continuous = true;
    instance.maxAlternatives = 1;
    instance.onstart = () => {
      if (currentGeneration !== generation || disposed) return;
    };
    instance.onprocessing = () => {
      if (currentGeneration !== generation || disposed) return;
      publish({ status: 'transcribing' });
    };
    instance.onresult = (event) => {
      if (currentGeneration !== generation || disposed) return;
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const key = `${index}:${text}`;
          if (!seenFinalResults.has(key)) {
            seenFinalResults.add(key);
            finalText += text;
          }
        } else interimText += text;
      }
      if (finalText) {
        committedTranscript =
          `${committedTranscript}${committedTranscript ? ' ' : ''}${finalText.trim()}`.trim();
      }
      publish({
        transcript: `${committedTranscript}${interimText ? ` ${interimText}` : ''}`.trim(),
      });
    };
    instance.onerror = (event) => {
      if (currentGeneration !== generation || disposed) return;
      invalidate();
      stopRecognition(true);
      publish({ status: 'error', error: event.message || errorMessage(event.error) });
    };
    instance.onend = () => {
      if (currentGeneration !== generation || disposed) return;
      invalidate();
      detach(instance);
      recognition = undefined;
      publish({
        status: state.transcript ? 'review' : 'error',
        error: state.transcript ? null : 'No speech was detected.',
      });
    };
    try {
      instance.start();
      timeout = setTimeout(() => dispatch('stop'), Math.max(1, options.timeoutMs ?? 60_000));
    } catch {
      invalidate();
      stopRecognition(true);
      publish({ status: 'error', error: 'Speech recognition could not start.' });
    }
  };
  const stop = (): void => {
    if (state.status !== 'listening') return;
    clearTimeoutHandle();
    const instance = recognition;
    if (!instance) {
      publish({
        status: state.transcript ? 'review' : 'error',
        error: state.transcript ? null : 'Speech recognition stopped without a transcript.',
      });
      return;
    }
    try {
      instance.stop();
      if (recognition !== instance) return;
      stopTimeout = setTimeout(() => {
        if (recognition !== instance) return;
        invalidate();
        stopRecognition(true);
        publish({
          status: state.transcript ? 'review' : 'error',
          error: state.transcript ? null : 'Speech recognition stopped without a transcript.',
        });
      }, instance.responseTimeoutMs ?? 1_000);
    } catch {
      invalidate();
      stopRecognition(true);
      publish({
        status: state.transcript ? 'review' : 'error',
        error: state.transcript ? null : 'Speech recognition stopped without a transcript.',
      });
    }
  };
  const cancel = (): void => {
    invalidate();
    stopRecognition(true);
    targetPaneId = null;
    publish({ status: 'idle', transcript: '', error: null });
  };
  const clear = (): void => {
    if (state.status !== 'review' && !(state.status === 'error' && state.transcript.trim())) return;
    committedTranscript = '';
    publish({ status: 'review', transcript: '', error: null });
  };
  const insert = (): void => {
    if (!['review', 'error'].includes(state.status) || !state.transcript.trim()) return;
    const target = targetPaneId;
    if (!target || options.getTargetPaneId() !== target || !options.canInsert(target)) {
      publish({
        status: 'error',
        error: 'The dictation target is no longer connected or selected.',
      });
      return;
    }
    const text = state.transcript.replace(/\r\n|\r|\n/g, ' ');
    if (!text.trim()) return;
    try {
      if (!options.onInsert(target, text)) throw new Error('rejected');
    } catch {
      publish({ status: 'error', error: 'The selected pane rejected the dictation.' });
      return;
    }
    targetPaneId = null;
    publish({ status: 'idle', transcript: '', error: null });
  };
  const dispatch = (action: DictationAction): void => {
    if (disposed) return;
    if (action === 'start') start();
    else if (action === 'startNote') start(true);
    else if (action === 'stop') stop();
    else if (action === 'cancel') cancel();
    else if (action === 'clear') clear();
    else insert();
  };
  options.onState({ ...state });
  return {
    dispatch,
    editDraft(text) {
      if (disposed) return;
      if (state.status === 'review' || (state.status === 'error' && state.transcript.trim())) {
        committedTranscript = text;
        publish({ status: 'review', transcript: text, error: null });
      }
    },
    getState: () => ({ ...state }),
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      stopRecognition(true);
      targetPaneId = null;
    },
  };
}
