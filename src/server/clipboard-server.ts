import { execFile as nodeExecFile } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

export const CLIPBOARD_PATH = '/clipboard';
export const CLIPBOARD_MAX_BYTES = 256 * 1024;
export const CLIPBOARD_PROTOCOL = 'mux-xr-clipboard-v1';
const MIN_SECRET_CHARS = 32;
const MAX_SECRET_FILE_BYTES = 4096;
const MAX_CONNECTIONS = 8;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 15_000;
const PROCESS_TIMEOUT_MS = 5_000;
const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 60_000;

export type ClipboardOperation = 'read' | 'write';
export type ClipboardErrorCode =
  | 'disabled'
  | 'auth'
  | 'too_large'
  | 'invalid_text'
  | 'host_failed'
  | 'protocol';

export class ClipboardHostError extends Error {
  constructor(readonly code: 'too_large' | 'invalid_text' | 'host_failed') {
    super(code);
  }
}

/** Reads and writes the macOS pasteboard. Implementations never log the text. */
export interface ClipboardHost {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export type ClipboardSecret = { enabled: true; key: Buffer } | { enabled: false; reason: string };

type SecretFile = { isFile: boolean; mode: number; uid: number; data: Buffer; truncated: boolean };

type SecretFs = {
  /** Opens without following a final symlink, fstats the descriptor and reads a bounded prefix. */
  open: (path: string, maxBytes: number) => SecretFile;
  uid: () => number | undefined;
};

const openSecretFile = (path: string, maxBytes: number): SecretFile => {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile())
      return {
        isFile: false,
        mode: info.mode,
        uid: info.uid,
        data: Buffer.alloc(0),
        truncated: false,
      };
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    return {
      isFile: true,
      mode: info.mode,
      uid: info.uid,
      data: buffer.subarray(0, Math.min(length, maxBytes)),
      truncated: length > maxBytes,
    };
  } finally {
    closeSync(fd);
  }
};

const defaultSecretFs: SecretFs = { open: openSecretFile, uid: () => process.getuid?.() };

export const CLIPBOARD_SECRET_REQUIREMENT = `at least ${MIN_SECRET_CHARS} characters (openssl rand -base64 32 gives 44)`;

/**
 * Loads the pairing secret from a file the user created. Never creates or defaults one: any problem
 * disables clipboard sync and leaves dictation running.
 */
export const loadClipboardSecret = (
  path: string | undefined,
  fs: SecretFs = defaultSecretFs,
): ClipboardSecret => {
  if (!path) return { enabled: false, reason: 'no --clipboard-secret-file configured' };
  let file: SecretFile;
  try {
    file = fs.open(path, MAX_SECRET_FILE_BYTES);
  } catch (error) {
    return {
      enabled: false,
      reason:
        (error as NodeJS.ErrnoException).code === 'ELOOP'
          ? 'secret path is a symlink'
          : 'secret file is missing or unreadable',
    };
  }
  if (!file.isFile) return { enabled: false, reason: 'secret path is not a regular file' };
  if ((file.mode & 0o077) !== 0)
    return { enabled: false, reason: 'secret file is group- or world-accessible (chmod 600 it)' };
  const uid = fs.uid();
  if (uid !== undefined && file.uid !== uid)
    return { enabled: false, reason: 'secret file is not owned by the server user' };
  if (file.truncated)
    return { enabled: false, reason: `secret file is larger than ${MAX_SECRET_FILE_BYTES} bytes` };
  const secret = file.data.toString('utf8').trim();
  if (!secret) return { enabled: false, reason: 'secret file is empty' };
  if ([...secret].length < MIN_SECRET_CHARS)
    return { enabled: false, reason: `secret must be ${CLIPBOARD_SECRET_REQUIREMENT}` };
  return { enabled: true, key: Buffer.from(secret, 'utf8') };
};

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Size-capped, NUL-free, valid UTF-8 text, or the reason it is not. */
export const decodeClipboardText = (
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; code: 'too_large' | 'invalid_text' } => {
  if (bytes.byteLength > CLIPBOARD_MAX_BYTES) return { ok: false, code: 'too_large' };
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { ok: false, code: 'invalid_text' };
  }
  if (text.includes('\0')) return { ok: false, code: 'invalid_text' };
  return { ok: true, text };
};

export const clipboardMac = (key: Buffer, nonce: string, op: ClipboardOperation): Buffer =>
  createHmac('sha256', key).update(`${CLIPBOARD_PROTOCOL}\n${nonce}\n${op}`).digest();

type ExecFileLike = (
  file: string,
  args: string[],
  options: {
    encoding: 'buffer';
    timeout: number;
    maxBuffer: number;
    env: Record<string, string>;
    shell: false;
  },
  callback: (error: (Error & { code?: unknown }) | null, stdout: Buffer) => void,
) => {
  stdin: {
    on(event: 'error', listener: (error: Error) => void): unknown;
    end(chunk?: string | Buffer): void;
  } | null;
};

export type MacClipboardHostOptions = {
  execFile?: ExecFileLike;
  timeoutMs?: number;
  pbcopy?: string;
  pbpaste?: string;
};

/** pbcopy/pbpaste without a shell; text travels over stdin and stdout, never argv. */
export const createMacClipboardHost = (options: MacClipboardHostOptions = {}): ClipboardHost => {
  const execFile = options.execFile ?? (nodeExecFile as unknown as ExecFileLike);
  const timeout = options.timeoutMs ?? PROCESS_TIMEOUT_MS;
  const run = (file: string, input: Buffer): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        file,
        [],
        {
          encoding: 'buffer',
          timeout,
          maxBuffer: CLIPBOARD_MAX_BYTES,
          env: { LC_CTYPE: 'UTF-8', PATH: '/usr/bin:/bin' },
          shell: false,
        },
        (error, stdout) => {
          // The error object can carry stdout, so only its code leaves this callback.
          if (!error) resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0));
          else
            reject(
              new ClipboardHostError(
                error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'too_large' : 'host_failed',
              ),
            );
        },
      );
      // pbcopy can exit before reading stdin; without a listener the EPIPE would crash the server.
      child.stdin?.on('error', () => reject(new ClipboardHostError('host_failed')));
      child.stdin?.end(input);
    });
  return {
    read: async () => {
      const decoded = decodeClipboardText(
        await run(options.pbpaste ?? '/usr/bin/pbpaste', Buffer.alloc(0)),
      );
      if (!decoded.ok) throw new ClipboardHostError(decoded.code);
      return decoded.text;
    },
    write: async (text) => {
      const bytes = Buffer.from(text, 'utf8');
      const decoded = decodeClipboardText(bytes);
      if (!decoded.ok) throw new ClipboardHostError(decoded.code);
      await run(options.pbcopy ?? '/usr/bin/pbcopy', bytes);
    },
  };
};

const expandIPv6 = (address: string): string[] | null => {
  const [head, tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  return [...left, ...Array(tail === undefined ? 0 : missing).fill('0'), ...right];
};

/** Rate-limit key: IPv4 (including IPv4-mapped IPv6) as is, other IPv6 grouped by its /64. */
export const clientKey = (address: string | undefined): string => {
  if (!address) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const groups = expandIPv6(address.split('%')[0].toLowerCase());
  if (!groups) return address;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
};

export type FailureLimiter = {
  /** Failures inside the window reach the limit. */
  blocked(key: string): boolean;
  /** Failures plus auth attempts still in flight reach the limit. */
  saturated(key: string): boolean;
  begin(key: string): () => void;
  fail(key: string): void;
  size(): number;
};

export const createFailureLimiter = (
  now: () => number = Date.now,
  limit = FAILURE_LIMIT,
  windowMs = FAILURE_WINDOW_MS,
): FailureLimiter => {
  const failures = new Map<string, number[]>();
  const pending = new Map<string, number>();
  const sweep = (): void => {
    const cutoff = now() - windowMs;
    for (const [key, times] of failures) {
      const kept = times.filter((at) => at > cutoff);
      if (kept.length) failures.set(key, kept);
      else failures.delete(key);
    }
  };
  const count = (key: string): number => {
    sweep();
    return failures.get(key)?.length ?? 0;
  };
  return {
    blocked: (key) => count(key) >= limit,
    saturated: (key) => count(key) + (pending.get(key) ?? 0) >= limit,
    begin: (key) => {
      pending.set(key, (pending.get(key) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const left = (pending.get(key) ?? 1) - 1;
        if (left > 0) pending.set(key, left);
        else pending.delete(key);
      };
    },
    fail: (key) => {
      sweep();
      failures.set(key, [...(failures.get(key) ?? []), now()]);
    },
    size: () => {
      sweep();
      return failures.size + pending.size;
    },
  };
};

export type ClipboardEvent =
  | { kind: 'transfer'; direction: 'host-to-quest' | 'quest-to-host'; bytes: number }
  | { kind: 'refused'; code: ClipboardErrorCode | 'rate_limited' | 'origin' | 'busy' };

export type ClipboardServerOptions = {
  allowedOrigins: string[];
  /** Called per connection so a newly created or removed secret file applies without a restart. */
  loadSecret: () => ClipboardSecret;
  host?: ClipboardHost;
  now?: () => number;
  authTimeoutMs?: number;
  maxConnections?: number;
  limiter?: FailureLimiter;
  /** Counts and sizes only; never clipboard text or the secret. */
  onEvent?: (event: ClipboardEvent) => void;
};

export type ClipboardRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

const rawBytes = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);

const ERROR_MESSAGES: Record<ClipboardErrorCode, string> = {
  disabled: 'Host clipboard sync is not set up on the host.',
  auth: 'Host clipboard authentication failed.',
  too_large: `Clipboard text exceeds the ${CLIPBOARD_MAX_BYTES / 1024} KiB limit.`,
  invalid_text: 'Clipboard content must be UTF-8 text without NUL bytes.',
  host_failed: 'The host clipboard could not be accessed.',
  protocol: 'Unexpected clipboard message.',
};

export const createClipboardRoute = (options: ClipboardServerOptions): ClipboardRoute => {
  const host = options.host ?? createMacClipboardHost();
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  const sockets = new Set<WebSocket>();
  let upgrading = 0;
  let hostQueue: Promise<unknown> = Promise.resolve();
  // One pbcopy or pbpaste at a time, so concurrent transfers cannot interleave on the pasteboard.
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = hostQueue.then(operation, operation);
    hostQueue = result.catch(() => undefined);
    return result;
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: CLIPBOARD_MAX_BYTES });
  const emit = (event: ClipboardEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Observability must not interrupt clipboard transfers. */
    }
  };
  const refuseHttp = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !options.allowedOrigins.includes(origin)) {
      emit({ kind: 'refused', code: 'origin' });
      refuseHttp(socket, '403 Forbidden');
      return;
    }
    const ip = clientKey(request.socket.remoteAddress);
    if (limiter.saturated(ip)) {
      emit({ kind: 'refused', code: 'rate_limited' });
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    if (sockets.size + upgrading >= maxConnections) {
      emit({ kind: 'refused', code: 'busy' });
      refuseHttp(socket, '503 Service Unavailable');
      return;
    }
    const attempt = limiter.begin(ip);
    let reserved = true;
    const release = (): void => {
      if (!reserved) return;
      reserved = false;
      upgrading -= 1;
    };
    upgrading += 1;
    // A failed handshake never reaches the callback, so the raw socket's close releases both.
    socket.once('close', () => {
      release();
      attempt();
    });
    wss.handleUpgrade(request, socket, head, (client) => {
      release();
      serve(client, ip, attempt);
    });
  };

  const serve = (socket: WebSocket, ip: string, attempt: () => void): void => {
    sockets.add(socket);
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(code, reason);
    };
    const fail = (code: ClipboardErrorCode, closeCode = 1008): void => {
      emit({ kind: 'refused', code });
      if (code === 'auth') limiter.fail(ip);
      attempt();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code, message: ERROR_MESSAGES[code] }));
      finish(closeCode, code);
    };
    socket.on('close', () => {
      attempt();
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      sockets.delete(socket);
    });
    socket.on('error', () => undefined);

    const secret = options.loadSecret();
    if (!secret.enabled) {
      fail('disabled');
      return;
    }
    const nonce = randomBytes(32).toString('base64');
    let phase: 'auth' | 'write' | 'busy' = 'auth';
    timers.push(
      setTimeout(() => {
        if (phase === 'auth') fail('auth');
      }, authTimeoutMs),
      setTimeout(() => finish(1000, 'session timeout'), SESSION_TIMEOUT_MS),
    );
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: CLIPBOARD_PROTOCOL }));

    socket.on('message', async (data, isBinary) => {
      if (finished) return;
      if (phase === 'auth') {
        if (isBinary) {
          fail('auth');
          return;
        }
        let message: { type?: unknown; op?: unknown; mac?: unknown };
        try {
          message = JSON.parse(rawBytes(data).toString('utf8'));
        } catch {
          fail('auth');
          return;
        }
        const op = message?.op;
        if (
          message?.type !== 'auth' ||
          (op !== 'read' && op !== 'write') ||
          typeof message.mac !== 'string'
        ) {
          fail('auth');
          return;
        }
        if (limiter.blocked(ip)) {
          fail('auth');
          return;
        }
        const provided = Buffer.from(message.mac, 'base64');
        const expected = clipboardMac(secret.key, nonce, op);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          fail('auth');
          return;
        }
        attempt();
        if (op === 'write') {
          phase = 'write';
          socket.send(JSON.stringify({ type: 'ready' }));
          return;
        }
        phase = 'busy';
        try {
          const bytes = Buffer.from(await serialized(() => host.read()), 'utf8');
          if (finished) return;
          socket.send(bytes, { binary: true });
          emit({ kind: 'transfer', direction: 'host-to-quest', bytes: bytes.length });
          finish(1000, 'complete');
        } catch (error) {
          fail(error instanceof ClipboardHostError ? error.code : 'host_failed', 1011);
        }
        return;
      }
      if (phase !== 'write') {
        fail('protocol');
        return;
      }
      phase = 'busy';
      if (!isBinary) {
        fail('invalid_text', 1003);
        return;
      }
      const decoded = decodeClipboardText(rawBytes(data));
      if (!decoded.ok) {
        fail(decoded.code, decoded.code === 'too_large' ? 1009 : 1007);
        return;
      }
      try {
        await serialized(() => host.write(decoded.text));
        if (finished) return;
        const bytes = Buffer.byteLength(decoded.text, 'utf8');
        socket.send(JSON.stringify({ type: 'ok', bytes }));
        emit({ kind: 'transfer', direction: 'quest-to-host', bytes });
        finish(1000, 'complete');
      } catch (error) {
        fail(error instanceof ClipboardHostError ? error.code : 'host_failed', 1011);
      }
    });
  };

  return {
    handleUpgrade,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
