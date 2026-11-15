import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import type {
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from './speech-input';

export interface LocalSpeechRecognition extends SpeechRecognitionLike {
  onprocessing: (() => void) | null;
  readonly responseTimeoutMs: number;
}

export interface LocalSpeechRecognitionOptions {
  responseTimeoutMs?: number;
  /** The host pairing secret; absent means a paired `/dictate` fails naming the pairing step. */
  secret?: () => string | null;
}

const MAX_DURATION_MS = 60_000;
const MAX_CLIP_BYTES = 8 * 1024 * 1024;
const DEFAULT_RESPONSE_TIMEOUT_MS = 90_000;
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'];

/** Shown when a paired `/dictate` rejects the clip and no pairing secret is stored. */
export const DICTATE_PAIRING_MESSAGE =
  'Local dictation now requires the host pairing secret. Complete pairing in Settings → Host clipboard, then retry.';

/** Mirrors the host service's `DICTATE_PROTOCOL`; the label is a wire contract. */
const DICTATE_PROTOCOL = 'mux-xr-dictate-v1';

type MediaRecorderConstructor = typeof MediaRecorder & {
  isTypeSupported?: (mimeType: string) => boolean;
};

function scope(): typeof globalThis & {
  MediaRecorder?: MediaRecorderConstructor;
  WebSocket?: typeof WebSocket;
} {
  return globalThis as typeof globalThis & {
    MediaRecorder?: MediaRecorderConstructor;
    WebSocket?: typeof WebSocket;
  };
}

export function isLocalSpeechSupported(): boolean {
  const browser = scope();
  return Boolean(
    browser.MediaRecorder && browser.WebSocket && navigator.mediaDevices?.getUserMedia,
  );
}

export function createLocalSpeechRecognition(
  url: string,
  options: LocalSpeechRecognitionOptions = {},
): LocalSpeechRecognition {
  const browser = scope();
  let generation = 0;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let socket: WebSocket | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let responseTimer: ReturnType<typeof setTimeout> | undefined;
  let chunks: Blob[] = [];
  let chunkBytes = 0;
  let active = false;
  let processing = false;
  const responseTimeoutMs = Math.max(1, options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS);

  const recognition: LocalSpeechRecognition = {
    lang: 'en-US',
    interimResults: true,
    continuous: true,
    maxAlternatives: 1,
    onstart: null,
    onresult: null,
    onerror: null,
    onend: null,
    onprocessing: null,
    responseTimeoutMs,
    start: () => start(),
    stop: () => stop(),
    abort: () => abort(),
  };

  const clearTimers = (): void => {
    if (durationTimer !== undefined) clearTimeout(durationTimer);
    if (responseTimer !== undefined) clearTimeout(responseTimer);
    durationTimer = undefined;
    responseTimer = undefined;
  };

  const releaseStream = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
  };

  const emitError = (code: string, message: string, currentGeneration: number): void => {
    if (currentGeneration !== generation) return;
    recognition.onerror?.(
      Object.assign(new Event('error'), {
        error: code,
        code,
        message,
      }) as SpeechRecognitionErrorEventLike,
    );
  };

  const closeSocket = (): void => {
    const current = socket;
    socket = undefined;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) {
        current.close();
      }
    } catch {
      // The browser may have already closed the socket.
    }
  };

  const invalidate = (): void => {
    generation += 1;
    clearTimers();
    active = false;
    processing = false;
    const currentRecorder = recorder;
    recorder = undefined;
    if (currentRecorder) {
      currentRecorder.ondataavailable = null;
      currentRecorder.onerror = null;
      currentRecorder.onstop = null;
      try {
        if (currentRecorder.state !== 'inactive') currentRecorder.stop();
      } catch {
        // The recorder may have ended concurrently.
      }
    }
    releaseStream();
    closeSocket();
    chunks = [];
    chunkBytes = 0;
  };

  const fail = (code: string, message: string, currentGeneration: number): void => {
    if (currentGeneration !== generation) return;
    emitError(code, message, currentGeneration);
    invalidate();
    recognition.onend?.();
  };

  const beginUpload = (currentGeneration: number): void => {
    if (currentGeneration !== generation) return;
    processing = true;
    recognition.onprocessing?.();
    const WebSocketConstructor = browser.WebSocket;
    if (!WebSocketConstructor) {
      fail('service-not-allowed', 'Local speech service is unavailable.', currentGeneration);
      return;
    }
    let currentSocket: WebSocket;
    try {
      currentSocket = new WebSocketConstructor(url);
    } catch {
      fail('service-not-allowed', 'Local speech service could not start.', currentGeneration);
      return;
    }
    socket = currentSocket;
    responseTimer = setTimeout(() => {
      fail('network', 'Local speech service timed out.', currentGeneration);
    }, responseTimeoutMs);
    currentSocket.onopen = () => {
      if (currentGeneration !== generation || socket !== currentSocket) return;
      try {
        currentSocket.send(new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
      } catch {
        fail('network', 'Local speech service could not receive the recording.', currentGeneration);
      }
    };
    currentSocket.onmessage = (event: MessageEvent): void => {
      if (
        currentGeneration !== generation ||
        socket !== currentSocket ||
        typeof event.data !== 'string'
      )
        return;
      let response: unknown;
      try {
        response = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!response || typeof response !== 'object') return;
      const payload = response as {
        type?: unknown;
        text?: unknown;
        message?: unknown;
        code?: unknown;
      };
      if (payload.type === 'transcript' && typeof payload.text === 'string') {
        clearTimers();
        closeSocket();
        processing = false;
        recognition.onresult?.(
          Object.assign(new Event('result'), {
            resultIndex: 0,
            results: {
              length: 1,
              0: { isFinal: true, length: 1, 0: { transcript: payload.text } },
            },
          }) as SpeechRecognitionEventLike,
        );
        recognition.onend?.();
      } else if (payload.type === 'error' && payload.code === 'protocol' && !payload.message) {
        // A paired `/dictate` refused the unauthenticated clip; answer its challenge or stop.
        beginAuthenticatedUpload(currentGeneration);
      } else if (payload.type === 'error' && typeof payload.message === 'string') {
        fail('service-not-allowed', payload.message, currentGeneration);
      }
    };
    currentSocket.onerror = () =>
      fail('network', 'Local speech service could not be reached.', currentGeneration);
    currentSocket.onclose = () => {
      if (socket === currentSocket)
        fail('network', 'Local speech service closed before returning text.', currentGeneration);
    };
  };

  /**
   * The paired-`/dictate` upload: the server refused the plain clip, so answer its challenge
   * through the shared pairing client and send the recording only after the auth frame. Without a
   * stored pairing secret the recognition stops naming the pairing step instead of retrying.
   */
  const beginAuthenticatedUpload = (currentGeneration: number): void => {
    const secret = options.secret ? options.secret() : createHostClipboardSecretStore().get();
    if (!secret) {
      fail('service-not-allowed', DICTATE_PAIRING_MESSAGE, currentGeneration);
      return;
    }
    const subtle = globalThis.crypto?.subtle;
    const WebSocketConstructor = browser.WebSocket;
    if (!subtle || !WebSocketConstructor) {
      fail('network', 'Local speech service could not start.', currentGeneration);
      return;
    }
    closeSocket();
    if (responseTimer !== undefined) {
      clearTimeout(responseTimer);
      responseTimer = undefined;
    }
    const clip = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    let serverMessage: string | undefined;
    void openPairedSocket<string, 'timeout' | 'network' | 'service-not-allowed'>({
      url,
      secret,
      protocol: DICTATE_PROTOCOL,
      material: '',
      authFields: { request: '' },
      timeoutMs: responseTimeoutMs,
      onTimeout: () => 'timeout',
      subtle,
      socketFactory: (target) => new WebSocketConstructor(target) as unknown as HostClipboardSocket,
      onSocket: (pairedSocket) => {
        socket = pairedSocket as unknown as WebSocket;
      },
      onAuthSent: () => {
        socket?.send(clip);
      },
      onOpenError: () => 'network',
      onServerError: (code, message) => {
        serverMessage = typeof message === 'string' ? message : undefined;
        return code === 'auth' ? 'service-not-allowed' : 'network';
      },
      onClose: () => 'network',
      onMessage: (message) => {
        const payload = message as { type?: unknown; text?: unknown };
        if (payload?.type === 'transcript' && typeof payload.text === 'string')
          return { ok: true, value: payload.text };
        return null;
      },
    }).then((outcome) => {
      if (currentGeneration !== generation) return;
      processing = false;
      if (outcome.ok) {
        recognition.onresult?.(
          Object.assign(new Event('result'), {
            resultIndex: 0,
            results: {
              length: 1,
              0: { isFinal: true, length: 1, 0: { transcript: outcome.value } },
            },
          }) as SpeechRecognitionEventLike,
        );
        recognition.onend?.();
        return;
      }
      if (outcome.code === 'service-not-allowed')
        fail('service-not-allowed', serverMessage ?? DICTATE_PAIRING_MESSAGE, currentGeneration);
      else if (outcome.code === 'timeout')
        fail('network', 'Local speech service timed out.', currentGeneration);
      else fail('network', 'Local speech service could not be reached.', currentGeneration);
    });
  };

  const stopCapture = (currentGeneration: number): void => {
    if (currentGeneration !== generation || !recorder) return;
    const currentRecorder = recorder;
    recorder = undefined;
    clearTimers();
    currentRecorder.onstop = () => {
      if (currentGeneration !== generation) return;
      releaseStream();
      if (chunkBytes === 0) {
        fail('no-speech', 'No speech was detected.', currentGeneration);
        return;
      }
      beginUpload(currentGeneration);
    };
    try {
      if (currentRecorder.state !== 'inactive') currentRecorder.stop();
      else currentRecorder.onstop(new Event('stop'));
    } catch {
      fail('audio-capture', 'The microphone recording could not stop.', currentGeneration);
    }
  };

  function start(): void {
    if (active || processing) return;
    const currentGeneration = ++generation;
    chunks = [];
    chunkBytes = 0;
    active = true;
    const mediaDevices = navigator.mediaDevices;
    const MediaRecorderConstructor = browser.MediaRecorder;
    if (!MediaRecorderConstructor || !mediaDevices?.getUserMedia) {
      fail(
        'service-not-allowed',
        'Local microphone recording is not supported in this browser.',
        currentGeneration,
      );
      return;
    }
    void mediaDevices
      .getUserMedia({ audio: true })
      .then((currentStream) => {
        if (currentGeneration !== generation || !active) {
          for (const track of currentStream.getTracks()) track.stop();
          return;
        }
        stream = currentStream;
        const mimeType = PREFERRED_MIME_TYPES.find((value) => {
          try {
            return MediaRecorderConstructor.isTypeSupported?.(value) ?? false;
          } catch {
            return false;
          }
        });
        try {
          recorder = mimeType
            ? new MediaRecorderConstructor(currentStream, { mimeType })
            : new MediaRecorderConstructor(currentStream);
        } catch {
          fail('audio-capture', 'The microphone recorder could not start.', currentGeneration);
          return;
        }
        const currentRecorder = recorder;
        currentRecorder.ondataavailable = (event: BlobEvent): void => {
          if (currentGeneration !== generation || event.data.size === 0) return;
          chunkBytes += event.data.size;
          if (chunkBytes > MAX_CLIP_BYTES) {
            fail('audio-capture', 'The recording exceeded the 8 MiB limit.', currentGeneration);
            return;
          }
          chunks.push(event.data);
        };
        currentRecorder.onerror = () =>
          fail('audio-capture', 'The microphone recording failed.', currentGeneration);
        try {
          currentRecorder.start();
        } catch {
          fail('audio-capture', 'The microphone recorder could not start.', currentGeneration);
          return;
        }
        recognition.onstart?.();
        durationTimer = setTimeout(() => stopCapture(currentGeneration), MAX_DURATION_MS);
      })
      .catch((error: unknown) => {
        if (currentGeneration !== generation) return;
        const name = error instanceof DOMException ? error.name : '';
        fail(
          name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture',
          name === 'NotAllowedError'
            ? 'Microphone permission was denied.'
            : 'No microphone is available.',
          currentGeneration,
        );
      });
  }

  function stop(): void {
    if (!active) return;
    active = false;
    const currentGeneration = generation;
    if (!recorder) {
      generation += 1;
      clearTimers();
      releaseStream();
      recognition.onend?.();
      return;
    }
    stopCapture(currentGeneration);
  }

  function abort(): void {
    invalidate();
  }

  return recognition;
}
