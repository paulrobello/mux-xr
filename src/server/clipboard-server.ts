import { execFile as nodeExecFile } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { RawData } from 'ws';
import {
  createPairedRoute,
  type PairedAuthMessage,
  type PairedConnection,
  type PairedMessageHandler,
  type PairedRoute,
  pairedHmac,
} from './paired-route';

export { clientKey } from './paired-route';

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

export type SecretFile = {
  isFile: boolean;
  mode: number;
  uid: number;
  data: Buffer;
  truncated: boolean;
};

type SecretFs = {
  /** Opens without following a final symlink, fstats the descriptor and reads a bounded prefix. */
  open: (path: string, maxBytes: number) => SecretFile;
  uid: () => number | undefined;
};

/** Opens without following a final symlink and reads a bounded prefix; see {@link SecretFile}. */
export const openSecretFile = (path: string, maxBytes: number): SecretFile => {
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
  pairedHmac(key, CLIPBOARD_PROTOCOL, nonce, op);

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

export type ClipboardRoute = PairedRoute;

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
  // One pbcopy or pbpaste at a time, so concurrent transfers cannot interleave on the pasteboard.
  let hostQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = hostQueue.then(operation, operation);
    hostQueue = result.catch(() => undefined);
    return result;
  };
  const emitEvent = (event: ClipboardEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Observability must not interrupt clipboard transfers. */
    }
  };
  const hostFailure = (error: unknown, connection: PairedConnection): void => {
    connection.fail(error instanceof ClipboardHostError ? error.code : 'host_failed', 1011);
  };

  return createPairedRoute({
    protocol: CLIPBOARD_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    loadSecret: options.loadSecret,
    limiter,
    maxPayloadBytes: CLIPBOARD_MAX_BYTES,
    maxConnections: options.maxConnections ?? MAX_CONNECTIONS,
    reportGates: true,
    reportFailures: 'all',
    emit: (event) => emitEvent({ kind: 'refused', code: event.code as ClipboardErrorCode }),
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    validateAuth: (message: PairedAuthMessage) => message.op === 'read' || message.op === 'write',
    macMaterial: (message) => String(message.op),
    errorMessage: (code) => ERROR_MESSAGES[code as ClipboardErrorCode],
    onAuthenticated: (connection, message): PairedMessageHandler | undefined => {
      if (message.op === 'write') {
        connection.sendJson({ type: 'ready' });
        let phase: 'write' | 'busy' = 'write';
        return (data, isBinary) => {
          if (connection.finished()) return;
          if (phase !== 'write') {
            connection.fail('protocol');
            return;
          }
          phase = 'busy';
          if (!isBinary) {
            connection.fail('invalid_text', 1003);
            return;
          }
          const decoded = decodeClipboardText(rawBytes(data));
          if (!decoded.ok) {
            connection.fail(decoded.code, decoded.code === 'too_large' ? 1009 : 1007);
            return;
          }
          void (async () => {
            try {
              await serialized(() => host.write(decoded.text));
              if (connection.finished()) return;
              const bytes = Buffer.byteLength(decoded.text, 'utf8');
              connection.sendJson({ type: 'ok', bytes });
              emitEvent({ kind: 'transfer', direction: 'quest-to-host', bytes });
              connection.finish(1000, 'complete');
            } catch (error) {
              hostFailure(error, connection);
            }
          })();
        };
      }
      void (async () => {
        try {
          const bytes = Buffer.from(await serialized(() => host.read()), 'utf8');
          if (connection.finished()) return;
          connection.socket.send(bytes, { binary: true });
          emitEvent({ kind: 'transfer', direction: 'host-to-quest', bytes: bytes.length });
          connection.finish(1000, 'complete');
        } catch (error) {
          hostFailure(error, connection);
        }
      })();
    },
  });
};
