import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

const execFile = promisify(execFileCallback);
const MAX_PAYLOAD = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MS = 120_000;

export type DictationTranscriber = (bytes: Buffer, signal: AbortSignal) => Promise<string>;

export type DictationServerOptions = {
  allowedOrigins: string[];
  transcribe?: DictationTranscriber;
  model?: string;
  ffmpegPath?: string;
  whisperPath?: string;
  timeoutMs?: number;
};

type ActiveJob = { controller: AbortController; socket: WebSocket };

type LocalTranscriberOptions = {
  model: string;
  ffmpegPath: string;
  whisperPath: string;
};

export const createLocalTranscriber =
  (options: LocalTranscriberOptions): DictationTranscriber =>
  async (bytes, signal) => {
    const directory = await mkdtemp(join(tmpdir(), 'mux-xr-dictation-'));
    const inputPath = join(directory, `${randomUUID()}.webm`);
    const wavPath = join(directory, 'audio.wav');
    try {
      await writeFile(inputPath, bytes);
      await execFile(
        options.ffmpegPath,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          inputPath,
          '-t',
          '60',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-f',
          'wav',
          wavPath,
        ],
        { signal },
      );
      const { stdout } = await execFile(
        options.whisperPath,
        ['-m', options.model, '-f', wavPath, '-nt', '-np', '-l', 'en', '-t', '4', '-ng'],
        { signal, maxBuffer: 2 * 1024 * 1024 },
      );
      const text = stdout.trim();
      if (!text) throw new Error('Whisper returned an empty transcript.');
      return text;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

const rawDataToBuffer = (rawData: RawData): Buffer =>
  Buffer.isBuffer(rawData)
    ? rawData
    : Buffer.concat(Array.isArray(rawData) ? rawData : [Buffer.from(rawData)]);

const sendJson = (socket: WebSocket, message: Record<string, string>): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

export type AttachedDictationServer = { close: () => Promise<void> };

export const attachDictationServer = (
  server: Server,
  options: DictationServerOptions,
): AttachedDictationServer => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transcribe =
    options.transcribe ??
    createLocalTranscriber({
      model: options.model ?? '',
      ffmpegPath: options.ffmpegPath ?? '/opt/homebrew/bin/ffmpeg',
      whisperPath: options.whisperPath ?? '/opt/homebrew/bin/whisper-cli',
    });
  let activeJob: ActiveJob | null = null;
  let activeTask: Promise<void> | null = null;
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  const handleUpgrade = (
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (
      requestUrl.pathname !== '/dictate' ||
      requestUrl.search ||
      typeof origin !== 'string' ||
      !options.allowedOrigins.includes(origin)
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  };
  server.on('upgrade', handleUpgrade);

  wss.on('connection', (socket) => {
    sockets.add(socket);
    let idleTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => socket.close(1000, 'idle timeout'),
      IDLE_TIMEOUT_MS,
    );
    const clearIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    socket.on('message', async (rawData, isBinary) => {
      clearIdleTimer();
      if (!isBinary) {
        sendJson(socket, { type: 'error', message: 'Expected one binary audio clip.' });
        socket.close(1003, 'binary audio required');
        return;
      }
      const bytes = rawDataToBuffer(rawData);
      if (bytes.length > MAX_PAYLOAD) {
        sendJson(socket, { type: 'error', message: 'Audio clip exceeds the 8 MiB limit.' });
        socket.close(1009, 'payload too large');
        return;
      }
      if (activeJob) {
        sendJson(socket, { type: 'error', message: 'Another dictation is already in progress.' });
        socket.close(1013, 'dictation busy');
        return;
      }
      const controller = new AbortController();
      activeJob = { controller, socket };
      const transcription = transcribe(bytes, controller.signal);
      let timedOut = false;
      let timeoutReject!: (error: Error) => void;
      const timeoutSignal = new Promise<never>((_resolve, reject) => {
        timeoutReject = reject;
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Dictation timed out.'));
        timeoutReject(new Error('Dictation timed out.'));
      }, timeoutMs);
      let task: Promise<void>;
      task = (async () => {
        try {
          const text = await Promise.race([transcription, timeoutSignal]);
          sendJson(socket, { type: 'transcript', text });
          socket.close(1000, 'complete');
        } catch {
          if (socket.readyState === WebSocket.OPEN && (!controller.signal.aborted || timedOut)) {
            sendJson(socket, {
              type: 'error',
              message: timedOut ? 'Local dictation timed out.' : 'Local dictation failed.',
            });
            socket.close(1011, 'dictation failed');
          }
        } finally {
          clearTimeout(timeout);
          await transcription.catch(() => undefined);
          if (activeJob?.controller === controller) activeJob = null;
        }
      })();
      activeTask = task;
      try {
        await task;
      } finally {
        if (activeTask === task) activeTask = null;
      }
    });
    socket.on('close', () => {
      clearIdleTimer();
      sockets.delete(socket);
      if (activeJob?.socket === socket)
        activeJob.controller.abort(new Error('Client disconnected.'));
    });
    socket.on('error', () => undefined);
  });

  return {
    close: async () => {
      server.off('upgrade', handleUpgrade);
      activeJob?.controller.abort(new Error('Server stopping.'));
      for (const socket of sockets) socket.terminate();
      if (activeTask) {
        await Promise.race([activeTask, new Promise((resolve) => setTimeout(resolve, 1_000))]);
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
