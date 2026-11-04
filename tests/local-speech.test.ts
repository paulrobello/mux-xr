import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalSpeechRecognition, isLocalSpeechSupported } from '../src/local-speech';

type FakeSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const originalMediaRecorder = globalThis.MediaRecorder;
const originalWebSocket = globalThis.WebSocket;
const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;

function setGetUserMedia(getUserMedia: typeof navigator.mediaDevices.getUserMedia): void {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
  }
  navigator.mediaDevices.getUserMedia = getUserMedia;
}

afterEach(() => {
  if (originalMediaRecorder) globalThis.MediaRecorder = originalMediaRecorder;
  else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
  else delete (globalThis as { WebSocket?: unknown }).WebSocket;
  if (navigator.mediaDevices && originalGetUserMedia)
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  vi.useRealTimers();
});

function installRecorder(): {
  recorder: {
    ondataavailable: ((event: BlobEvent) => void) | null;
    onstop: (() => void) | null;
    onerror: (() => void) | null;
    state: string;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  track: { stop: ReturnType<typeof vi.fn> };
} {
  const track = { stop: vi.fn() };
  const recorder = {
    ondataavailable: null as ((event: BlobEvent) => void) | null,
    onstop: null as (() => void) | null,
    onerror: null as (() => void) | null,
    state: 'inactive',
    start: vi.fn(function start(this: typeof recorder) {
      this.state = 'recording';
    }),
    stop: vi.fn(function stop(this: typeof recorder) {
      this.state = 'inactive';
      this.onstop?.();
    }),
  };
  const FakeMediaRecorder = Object.assign(
    function FakeMediaRecorder() {
      return recorder;
    },
    { isTypeSupported: (): boolean => true },
  );
  globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  setGetUserMedia(
    vi.fn(async () => ({
      getTracks: () => [track],
    })) as unknown as typeof navigator.mediaDevices.getUserMedia,
  );
  return { recorder, track };
}

function installSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  const FakeWebSocket = Object.assign(
    function FakeWebSocket() {
      return socket;
    },
    {
      OPEN: 1,
      CONNECTING: 0,
    },
  );
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  return socket;
}

describe('local speech recognition', () => {
  it('feature-detects the recording fallback without opening a device', () => {
    expect(isLocalSpeechSupported()).toBe(false);
  });

  it('stops a delayed permission request and releases the late stream', async () => {
    installRecorder();
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    let resolvePermission!: (value: typeof stream) => void;
    setGetUserMedia(
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolvePermission = resolve;
          }),
      ) as unknown as typeof navigator.mediaDevices.getUserMedia,
    );
    const recognition = createLocalSpeechRecognition('wss://example/dictate');
    const end = vi.fn();
    recognition.onend = end;
    recognition.start();
    recognition.stop();
    resolvePermission(stream);
    await Promise.resolve();
    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(recognition.onstart).toBeNull();
  });

  it('abort invalidates a stopped recorder before its late stop event', async () => {
    const { recorder } = installRecorder();
    const socket = installSocket();
    const recognition = createLocalSpeechRecognition('wss://example/dictate');
    recognition.start();
    await Promise.resolve();
    recorder.ondataavailable?.({ data: new Blob(['late']) } as BlobEvent);
    recorder.stop.mockImplementation(() => {
      recorder.state = 'inactive';
    });
    recognition.stop();
    recognition.abort();
    recorder.onstop?.();
    expect(socket.readyState).toBe(0);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('sends one exact Blob and emits the final transcript', async () => {
    const { recorder, track } = installRecorder();
    const socket = installSocket();
    const result = vi.fn();
    const processing = vi.fn();
    const recognition = createLocalSpeechRecognition('wss://example/dictate', {
      responseTimeoutMs: 1000,
    });
    recognition.onresult = result;
    recognition.onprocessing = processing;
    recognition.start();
    await Promise.resolve();
    const clip = new Blob(['hello'], { type: 'audio/webm' });
    recorder.ondataavailable?.({ data: clip } as BlobEvent);
    recognition.stop();
    socket.readyState = 1;
    socket.onopen?.();
    expect(processing).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledOnce();
    expect(await socket.send.mock.calls[0][0].text()).toBe('hello');
    socket.onmessage?.({ data: JSON.stringify({ type: 'transcript', text: 'hello world' }) });
    expect(result).toHaveBeenCalledWith(
      expect.objectContaining({
        results: expect.objectContaining({
          0: expect.objectContaining({ 0: expect.objectContaining({ transcript: 'hello world' }) }),
        }),
      }),
    );
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('surfaces service errors and abort suppresses stale socket callbacks', async () => {
    const { recorder } = installRecorder();
    const socket = installSocket();
    const error = vi.fn();
    const result = vi.fn();
    const recognition = createLocalSpeechRecognition('wss://example/dictate');
    recognition.onerror = error;
    recognition.onresult = result;
    recognition.start();
    await Promise.resolve();
    recorder.ondataavailable?.({ data: new Blob(['voice']) } as BlobEvent);
    recognition.stop();
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'offline' }) });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    recognition.abort();
    socket.onmessage?.({ data: JSON.stringify({ type: 'transcript', text: 'late' }) });
    expect(result).not.toHaveBeenCalled();
  });
});
