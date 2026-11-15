/**
 * The host service composition root: it wires every host route onto one HTTP server and dispatches
 * WebSocket upgrades by path. Local dictation on `/dictate` keeps the origin-only gate by default;
 * `dictate.requireAuth` moves it onto the shared paired-route handshake.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { promisify } from 'node:util';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  BOOKINGS_PATH,
  BOOKINGS_PROTOCOL,
  createBookingsFeed,
  createKanbanCli,
  createKanbanStripFeed,
  KANBAN_STRIP_PATH,
  KANBAN_STRIP_PROTOCOL,
  type KanbanCli,
  type KanbanStripFeedOptions,
} from './board-feeds';
import {
  CLIPBOARD_PATH,
  type ClipboardSecret,
  type ClipboardServerOptions,
  createClipboardRoute,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import type { DictationTelemetry, TranscriptionOutcome } from './dictation-telemetry';
import { createFeedRoute, type FeedRouteOptions } from './feed-route';
import {
  createHostStatsRoute,
  HOST_STATS_PATH,
  type HostStatsRouteOptions,
} from './host-stats-server';
import {
  createMeshInboxFeed,
  MESH_INBOX_PATH,
  MESH_INBOX_PROTOCOL,
  type MeshInboxFeedOptions,
} from './mesh-inbox';
import { createPairedRoute, type PairedMessageHandler, type PairedRoute } from './paired-route';
import {
  createPictureDepthRoute,
  PICTURE_DEPTH_PATH,
  type PictureDepthRouteOptions,
} from './picture-depth-server';
import {
  createPictureFetchRoute,
  PICTURE_FETCH_PATH,
  type PictureFetchRouteOptions,
} from './picture-fetch-server';
import {
  createRepoStatusRoute,
  REPO_STATUS_PATH,
  type RepoStatusRouteOptions,
} from './repo-status-server';
import {
  createServiceHealthFeed,
  SERVICE_HEALTH_PATH,
  SERVICE_HEALTH_PROTOCOL,
  type ServiceHealthFeedOptions,
} from './service-health';
import { createToastHub, TOASTS_PATH, type ToastHubOptions } from './toast-server';
import { createWeatherRoute, WEATHER_PATH, type WeatherRouteOptions } from './weather-server';

const execFile = promisify(execFileCallback);
const MAX_PAYLOAD = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MS = 120_000;

/** The paired handshake's protocol label on `/dictate`; mirrors the browser client's copy. */
export const DICTATE_PROTOCOL = 'mux-xr-dictate-v1';
/** Concurrent `/dictate` sockets allowed per service and per client address. */
const MAX_DICTATE_CONNECTIONS = 4;
const MAX_DICTATE_CONNECTIONS_PER_CLIENT = 2;
/** Extra time an authenticated session may stay open past the transcription deadline. */
const DICTATE_SESSION_MARGIN_MS = 15_000;

export type DictationTranscriber = (bytes: Buffer, signal: AbortSignal) => Promise<string>;

export type DictationServerOptions = {
  allowedOrigins: string[];
  /** Clock for the failure limiter and every route's timers; `clipboard.now` stays as a fallback. */
  now?: () => number;
  /**
   * Optional paired-route challenge on `/dictate` (`--dictate-auth on`). Off by default: every
   * existing setup keeps today's origin-only gate, and turning it on refuses clients that send
   * audio before proving they hold the pairing secret.
   */
  dictate?: { requireAuth: boolean };
  transcribe?: DictationTranscriber;
  model?: string;
  ffmpegPath?: string;
  whisperPath?: string;
  timeoutMs?: number;
  /** Clipboard sync on `/clipboard`; without it the route answers that sync is disabled. */
  clipboard?: Omit<ClipboardServerOptions, 'allowedOrigins'>;
  /** Read-only `/host-stats`, gated by the clipboard pairing secret. */
  hostStats?: Pick<
    HostStatsRouteOptions,
    | 'sampler'
    | 'requestLimiter'
    | 'authTimeoutMs'
    | 'sessionTimeoutMs'
    | 'maxConnectionsPerClient'
    | 'onEvent'
  >;
  /**
   * Git and CI status on `/repo-status`. It runs git and gh on paths a paired client names, so it
   * stays off unless `enabled`, even with clipboard pairing set up, and then also needs that secret.
   */
  repoStatus?: { enabled: boolean } & Omit<RepoStatusRouteOptions, 'allowedOrigins' | 'loadSecret'>;
  /**
   * Image fetching on `/picture-fetch` for hosts that send no CORS headers. The Mac makes outbound
   * requests for a paired client, so it stays off unless `enabled`, and then also needs the secret.
   */
  pictureProxy?: { enabled: boolean } & Omit<
    PictureFetchRouteOptions,
    'allowedOrigins' | 'loadSecret'
  >;
  /**
   * Depth estimation on `/picture-depth` for 3D picture frames. The Mac decodes images a paired
   * client uploads, so it stays off unless `enabled`, and then also needs the secret.
   */
  pictureDepth?: { enabled: boolean } & Omit<
    PictureDepthRouteOptions,
    'allowedOrigins' | 'loadSecret'
  >;
  /**
   * Kanban cards on `/kanban-strip` and host bookings on `/bookings`. They run the kanban CLI's
   * read commands, the cards for a project a paired client's pane names, so they stay off unless
   * `enabled`, and then also need the secret.
   */
  boardFeeds?: {
    enabled: boolean;
    cli?: KanbanCli;
    strip?: Omit<KanbanStripFeedOptions, 'cli'>;
    /** Clock for the bookings window. */
    now?: () => number;
  } & Pick<FeedRouteOptions, 'onEvent' | 'requestLimiter' | 'sessionTimeoutMs'>;
  /**
   * par-obs probe states on `/service-health`. The Mac queries Grafana with a Cloudflare Access
   * service token read from `envFile`, so it stays off unless `enabled`, and then also needs the
   * secret. The token never leaves this process.
   */
  serviceHealth?: { enabled: boolean } & ServiceHealthFeedOptions &
    Pick<FeedRouteOptions, 'onEvent' | 'requestLimiter' | 'sessionTimeoutMs'>;
  /**
   * Recent par-mesh envelopes on `/mesh-inbox`: the Mac runs `par-mesh history` for its own host.
   * Subjects name other agents' work, so it stays off unless `enabled`, and then also needs the
   * secret. Bodies and ack notes never leave the Mac.
   */
  meshInbox?: { enabled: boolean } & MeshInboxFeedOptions &
    Pick<FeedRouteOptions, 'onEvent' | 'requestLimiter' | 'sessionTimeoutMs'>;
  /**
   * Weather on `/weather`: the Mac looks up a US ZIP with zippopotam.us and the National Weather
   * Service. It only reaches those fixed hosts, so the clipboard pairing secret alone gates it.
   */
  weather?: Omit<WeatherRouteOptions, 'allowedOrigins' | 'loadSecret'>;
  /**
   * Toasts: senders POST `/toast` with the pairing secret as a bearer token, and paired headsets
   * receive them on `/toasts`. Only this Mac may send unless `allowRemoteSenders`.
   */
  toasts?: Pick<ToastHubOptions, 'allowRemoteSenders' | 'onEvent' | 'pingIntervalMs' | 'makeId'>;
  telemetry?: Pick<
    DictationTelemetry,
    'connected' | 'disconnected' | 'rejected' | 'beginTranscription'
  >;
};

type ActiveJob = { controller: AbortController; socket: WebSocket };

type LocalTranscriberOptions = {
  model: string;
  ffmpegPath: string;
  whisperPath: string;
};

/**
 * The ffmpeg argv for one clip: `-format_whitelist` keeps the probe to the containers browsers
 * record (Quest's MediaRecorder writes WebM/Opus; Safari's default is MP4), so attacker-supplied
 * bytes never reach any other demuxer.
 */
export const localTranscriberArgv = (inputPath: string, wavPath: string): string[] => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  'matroska,webm,mov,mp4',
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
];

export const createLocalTranscriber =
  (options: LocalTranscriberOptions): DictationTranscriber =>
  async (bytes, signal) => {
    const directory = await mkdtemp(join(tmpdir(), 'mux-xr-dictation-'));
    const inputPath = join(directory, `${randomUUID()}.webm`);
    const wavPath = join(directory, 'audio.wav');
    try {
      await writeFile(inputPath, bytes);
      await execFile(options.ffmpegPath, localTranscriberArgv(inputPath, wavPath), { signal });
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

/** Shared per-service wiring: one clock, one failure budget, one origin allow-list, one secret. */
export type HostServiceContext = {
  now: () => number;
  limiter: FailureLimiter;
  allowedOrigins: string[];
  loadSecret: () => ClipboardSecret;
};

type HostRoute = {
  path: string;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void> | void;
};

export type AttachedDictationServer = {
  /** Answers plain HTTP routes it owns (`/toast`); false leaves the request to the caller. */
  handleRequest: (request: IncomingMessage, response: ServerResponse) => boolean;
  close: () => Promise<void>;
};

export const attachHostService = (
  server: Server,
  options: DictationServerOptions,
): AttachedDictationServer => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const observe = (record: () => void): void => {
    try {
      record();
    } catch {
      /* Observability must not interrupt dictation. */
    }
  };
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
  const context: HostServiceContext = {
    now: options.now ?? options.clipboard?.now ?? Date.now,
    limiter:
      options.clipboard?.limiter ?? createFailureLimiter(options.now ?? options.clipboard?.now),
    allowedOrigins: options.allowedOrigins,
    loadSecret:
      options.clipboard?.loadSecret ??
      (() => ({ enabled: false, reason: 'no --clipboard-secret-file configured' }) as const),
  };
  /** A route secret that answers `disabled` until its feature flag turns the route on. */
  const gatedSecret = (enabled: boolean | undefined, reason: string): (() => ClipboardSecret) =>
    enabled ? context.loadSecret : () => ({ enabled: false, reason });
  const clipboardRoute = createClipboardRoute({
    ...options.clipboard,
    loadSecret: context.loadSecret,
    limiter: context.limiter,
    allowedOrigins: options.allowedOrigins,
  });
  const hostStatsRoute = createHostStatsRoute({
    ...options.hostStats,
    loadSecret: context.loadSecret,
    limiter: context.limiter,
    now: context.now,
    allowedOrigins: options.allowedOrigins,
  });
  const repoStatusRoute = createRepoStatusRoute({
    ...options.repoStatus,
    loadSecret: gatedSecret(
      options.repoStatus?.enabled,
      'repo status not enabled (--repo-status on)',
    ),
    limiter: context.limiter,
    allowedOrigins: options.allowedOrigins,
  });
  const pictureFetchRoute = createPictureFetchRoute({
    ...options.pictureProxy,
    loadSecret: gatedSecret(
      options.pictureProxy?.enabled,
      'picture proxy not enabled (--picture-proxy on)',
    ),
    limiter: context.limiter,
    allowedOrigins: options.allowedOrigins,
  });
  const boardSecret = gatedSecret(
    options.boardFeeds?.enabled,
    'board feeds not enabled (--board-feeds on)',
  );
  const kanbanCli = options.boardFeeds?.cli ?? createKanbanCli({ now: context.now });
  const boardRoute = (
    name: string,
    protocol: string,
    load: (request: string) => Promise<unknown>,
  ): ReturnType<typeof createFeedRoute> =>
    createFeedRoute({
      name,
      protocol,
      // A second layer behind the disabled secret: off never reaches the kanban CLI.
      load: options.boardFeeds?.enabled
        ? load
        : () => Promise.reject(new Error('board feeds not enabled')),
      loadSecret: boardSecret,
      limiter: context.limiter,
      now: context.now,
      allowedOrigins: options.allowedOrigins,
      onEvent: options.boardFeeds?.onEvent,
      requestLimiter: options.boardFeeds?.requestLimiter,
      sessionTimeoutMs: options.boardFeeds?.sessionTimeoutMs,
    });
  const serviceHealth = options.serviceHealth;
  const serviceHealthRoute = createFeedRoute({
    name: 'service-health',
    protocol: SERVICE_HEALTH_PROTOCOL,
    load: serviceHealth?.enabled
      ? createServiceHealthFeed(serviceHealth)
      : () => Promise.reject(new Error('service health not enabled')),
    loadSecret: gatedSecret(
      serviceHealth?.enabled,
      'service health not enabled (--service-health on)',
    ),
    limiter: context.limiter,
    now: context.now,
    allowedOrigins: options.allowedOrigins,
    onEvent: serviceHealth?.onEvent,
    requestLimiter: serviceHealth?.requestLimiter,
    sessionTimeoutMs: serviceHealth?.sessionTimeoutMs,
  });
  const kanbanStripRoute = boardRoute(
    'kanban-strip',
    KANBAN_STRIP_PROTOCOL,
    createKanbanStripFeed({ ...options.boardFeeds?.strip, cli: kanbanCli }),
  );
  const bookingsRoute = boardRoute(
    'bookings',
    BOOKINGS_PROTOCOL,
    createBookingsFeed({ cli: kanbanCli, now: options.boardFeeds?.now }),
  );
  const meshInbox = options.meshInbox;
  const meshInboxRoute = createFeedRoute({
    name: 'mesh-inbox',
    protocol: MESH_INBOX_PROTOCOL,
    load: meshInbox?.enabled
      ? createMeshInboxFeed({ now: context.now, ...meshInbox })
      : () => Promise.reject(new Error('mesh inbox not enabled')),
    loadSecret: gatedSecret(meshInbox?.enabled, 'mesh inbox not enabled (--mesh-inbox on)'),
    limiter: context.limiter,
    now: context.now,
    allowedOrigins: options.allowedOrigins,
    onEvent: meshInbox?.onEvent,
    requestLimiter: meshInbox?.requestLimiter,
    sessionTimeoutMs: meshInbox?.sessionTimeoutMs,
  });
  const weatherRoute = createWeatherRoute({
    ...options.weather,
    loadSecret: context.loadSecret,
    limiter: context.limiter,
    now: options.weather?.now ?? context.now,
    allowedOrigins: options.allowedOrigins,
  });
  const toastHub = createToastHub({
    ...options.toasts,
    loadSecret: context.loadSecret,
    limiter: context.limiter,
    now: context.now,
    allowedOrigins: options.allowedOrigins,
  });
  const pictureDepthRoute = createPictureDepthRoute({
    ...options.pictureDepth,
    loadSecret: gatedSecret(
      options.pictureDepth?.enabled,
      'picture depth not enabled (--picture-depth on)',
    ),
    limiter: context.limiter,
    allowedOrigins: options.allowedOrigins,
  });

  /** The single audio clip per connection: validation, the busy check and the transcription job. */
  const acceptAudio = async (
    socket: WebSocket,
    rawData: RawData,
    isBinary: boolean,
  ): Promise<void> => {
    if (!isBinary) {
      observe(() => options.telemetry?.rejected('invalid_payload'));
      sendJson(socket, { type: 'error', message: 'Expected one binary audio clip.' });
      socket.close(1003, 'binary audio required');
      return;
    }
    const bytes = rawDataToBuffer(rawData);
    if (bytes.length > MAX_PAYLOAD) {
      observe(() => options.telemetry?.rejected('invalid_payload'));
      sendJson(socket, { type: 'error', message: 'Audio clip exceeds the 8 MiB limit.' });
      socket.close(1009, 'payload too large');
      return;
    }
    if (activeJob) {
      observe(() => options.telemetry?.rejected('busy'));
      sendJson(socket, { type: 'error', message: 'Another dictation is already in progress.' });
      socket.close(1013, 'dictation busy');
      return;
    }
    const controller = new AbortController();
    activeJob = { controller, socket };
    let finishTelemetry: (outcome: TranscriptionOutcome) => void = () => undefined;
    observe(() => {
      finishTelemetry = options.telemetry?.beginTranscription(bytes.length) ?? finishTelemetry;
    });
    const transcription = Promise.resolve().then(() => transcribe(bytes, controller.signal));
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
        observe(() => finishTelemetry('success'));
        sendJson(socket, { type: 'transcript', text });
        socket.close(1000, 'complete');
      } catch {
        observe(() =>
          finishTelemetry(timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'error'),
        );
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
  };
  /** Cancels the job owned by a socket that just closed. */
  const cancelJobOnClose = (socket: WebSocket): void => {
    if (activeJob?.socket === socket) activeJob.controller.abort(new Error('Client disconnected.'));
  };
  const dictateLegacyRoute: HostRoute = {
    path: '/dictate',
    handleUpgrade: (request, socket, head) => {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !context.allowedOrigins.includes(origin)) {
        observe(() => options.telemetry?.rejected('origin'));
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
    },
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
  /**
   * `/dictate` with the paired handshake (`--dictate-auth on`): the challenge precedes any audio,
   * so attacker-supplied bytes never reach ffmpeg without a verified MAC. The caps bound sockets
   * per service (4) and per client address (2), answering 503 at upgrade like the feed routes.
   */
  const dictatePairedRoute: PairedRoute = createPairedRoute({
    protocol: DICTATE_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    loadSecret: context.loadSecret,
    limiter: context.limiter,
    maxPayloadBytes: MAX_PAYLOAD,
    maxConnections: MAX_DICTATE_CONNECTIONS,
    perClient: { cap: MAX_DICTATE_CONNECTIONS_PER_CLIENT, gate: 'busy', release: 'close' },
    reportGates: true,
    reportFailures: 'all',
    emit: (event) => {
      const code = event.code;
      observe(() =>
        options.telemetry?.rejected(
          code === 'protocol'
            ? 'invalid_payload'
            : (code as 'origin' | 'rate_limited' | 'busy' | 'auth' | 'disabled'),
        ),
      );
    },
    authTimeoutMs: 5_000,
    sessionTimeoutMs: timeoutMs + DICTATE_SESSION_MARGIN_MS,
    validateAuth: (message) => typeof message.request === 'string' && message.request === '',
    macMaterial: (message) => String(message.request),
    errorMessage: (code) =>
      code === 'busy'
        ? 'Another dictation is already in progress.'
        : code === 'auth'
          ? 'Local dictation authentication failed. Complete pairing in Settings → Host clipboard.'
          : code === 'disabled'
            ? 'Local dictation pairing is not configured on the host.'
            : undefined,
    onAuthenticated:
      (connection): PairedMessageHandler =>
      (data, isBinary) => {
        void acceptAudio(connection.socket, data, isBinary);
      },
    onConnectionClose: cancelJobOnClose,
  });
  const dictateRoute: HostRoute =
    options.dictate?.requireAuth === true
      ? {
          path: '/dictate',
          handleUpgrade: dictatePairedRoute.handleUpgrade,
          close: dictatePairedRoute.close,
        }
      : dictateLegacyRoute;
  /** Wraps a route object with its path so every map entry is a whole HostRoute. */
  const withPath = (path: string, route: Omit<HostRoute, 'path'>): HostRoute => ({
    path,
    ...route,
  });
  const routes = new Map<string, HostRoute>([
    [CLIPBOARD_PATH, withPath(CLIPBOARD_PATH, clipboardRoute)],
    [HOST_STATS_PATH, withPath(HOST_STATS_PATH, hostStatsRoute)],
    [REPO_STATUS_PATH, withPath(REPO_STATUS_PATH, repoStatusRoute)],
    [PICTURE_FETCH_PATH, withPath(PICTURE_FETCH_PATH, pictureFetchRoute)],
    [BOOKINGS_PATH, withPath(BOOKINGS_PATH, bookingsRoute)],
    [MESH_INBOX_PATH, withPath(MESH_INBOX_PATH, meshInboxRoute)],
    [SERVICE_HEALTH_PATH, withPath(SERVICE_HEALTH_PATH, serviceHealthRoute)],
    [KANBAN_STRIP_PATH, withPath(KANBAN_STRIP_PATH, kanbanStripRoute)],
    [WEATHER_PATH, withPath(WEATHER_PATH, weatherRoute)],
    [PICTURE_DEPTH_PATH, withPath(PICTURE_DEPTH_PATH, pictureDepthRoute)],
    [TOASTS_PATH, withPath(TOASTS_PATH, toastHub)],
    ['/dictate', dictateRoute],
  ]);
  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      observe(() => options.telemetry?.rejected('path'));
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const route = requestUrl.search ? undefined : routes.get(requestUrl.pathname);
    if (route) {
      route.handleUpgrade(request, socket, head);
      return;
    }
    observe(() => options.telemetry?.rejected('path'));
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
  };
  server.on('upgrade', handleUpgrade);

  wss.on('connection', (socket) => {
    sockets.add(socket);
    observe(() => options.telemetry?.connected());
    let idleTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => socket.close(1000, 'idle timeout'),
      IDLE_TIMEOUT_MS,
    );
    const clearIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    socket.on('message', (rawData, isBinary) => {
      clearIdleTimer();
      void acceptAudio(socket, rawData, isBinary);
    });
    socket.on('close', () => {
      clearIdleTimer();
      sockets.delete(socket);
      observe(() => options.telemetry?.disconnected());
      cancelJobOnClose(socket);
    });
    socket.on('error', (error) => {
      if ((error as Error & { code?: string }).code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH')
        observe(() => options.telemetry?.rejected('invalid_payload'));
    });
  });

  return {
    handleRequest: toastHub.handleRequest,
    close: async () => {
      server.off('upgrade', handleUpgrade);
      activeJob?.controller.abort(new Error('Server stopping.'));
      for (const socket of sockets) socket.terminate();
      if (activeTask) {
        await Promise.race([activeTask, new Promise((resolve) => setTimeout(resolve, 1_000))]);
      }
      for (const route of routes.values()) await route.close();
    },
  };
};
