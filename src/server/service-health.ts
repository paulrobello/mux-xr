import { readFileSync, statSync } from 'node:fs';
import { cleanText } from './board-feeds';
import { FeedError } from './feed-route';

export const SERVICE_HEALTH_PATH = '/service-health';
export const SERVICE_HEALTH_PROTOCOL = 'mux-xr-service-health-v1';
/** A probe's availability; a bare `par_obs_up == 0` keeps reading down after recovery. */
export const PAR_OBS_UP_QUERY = 'min by (host, service) (last_over_time(par_obs_up[5m]))';
/** Present only for checks configured `expected: down` (red-path canaries). */
export const PAR_OBS_EXPECTED_DOWN_QUERY =
  'max by (host, service) (last_over_time(par_obs_expected_down[5m]))';
const QUERY_PATH = '/api/datasources/proxy/uid/prometheus/api/v1/query';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 512 * 1024;
const RESULT_CACHE_MS = 30_000;
const MAX_PROBES = 80;
const MAX_LABEL_CHARS = 48;
const CREDENTIAL_KEYS = ['PAR_OBS_CF_ACCESS_CLIENT_ID', 'PAR_OBS_CF_ACCESS_CLIENT_SECRET'] as const;

export interface ParObsCredential {
  clientId: string;
  clientSecret: string;
}

export interface ParObsFileAccess {
  readFile?: (path: string) => string;
  /** The file's `st_mode`. */
  fileMode?: (path: string) => number;
  /** Told why a file was refused; it gets the path and reason, never the contents. */
  warn?: (line: string) => void;
}

/**
 * The CF Access service token from a `KEY=value` file; only the two keys are read. Null when the
 * file is missing, unreadable, open to group or others, or lacks either key. Values never reach a
 * log or an error.
 */
export const loadParObsCredential = (
  path: string,
  access: ParObsFileAccess = {},
): ParObsCredential | null => {
  const read = access.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const fileMode = access.fileMode ?? ((file: string) => statSync(file).mode);
  let text: string;
  try {
    const mode = fileMode(path);
    if (mode & 0o077) {
      access.warn?.(
        `Service health: refusing ${path}: group or others can access it (mode ${(mode & 0o777).toString(8)}); chmod 600 it.`,
      );
      return null;
    }
    text = read(path);
  } catch {
    return null;
  }
  const values: Partial<Record<(typeof CREDENTIAL_KEYS)[number], string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    const key = match?.[1] as (typeof CREDENTIAL_KEYS)[number] | undefined;
    if (!match || !key || !CREDENTIAL_KEYS.includes(key)) continue;
    let value = match[2] ?? '';
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
      value = value.slice(1, -1);
    values[key] = value;
  }
  const clientId = values.PAR_OBS_CF_ACCESS_CLIENT_ID;
  const clientSecret = values.PAR_OBS_CF_ACCESS_CLIENT_SECRET;
  // Header values must be plain visible text.
  const usable = (value: string | undefined): value is string =>
    typeof value === 'string' && /^[\x21-\x7e]{1,512}$/.test(value);
  return usable(clientId) && usable(clientSecret) ? { clientId, clientSecret } : null;
};

export type ProbeState = 'up' | 'down' | 'expected-down';

export interface ServiceProbe {
  host: string;
  service: string;
  state: ProbeState;
  /** When this streamer first saw the probe in its current state. */
  since: number;
  /** False until the streamer saw a change; until then `since` is only when it first looked. */
  sinceExact: boolean;
}

export interface ServiceHealth {
  /** When the streamer queried par-obs, on its own clock like `since`. */
  now: number;
  probes: ServiceProbe[];
  /** Probes down that are not expected to be. */
  down: number;
}

type Sample = { host: string; service: string; value: number };

/** One instant vector from the Prometheus query API, reduced to host, service and value. */
export const parseVector = (body: unknown): Sample[] | null => {
  const response = body as {
    status?: unknown;
    data?: { resultType?: unknown; result?: unknown };
  };
  if (response?.status !== 'success' || response.data?.resultType !== 'vector') return null;
  const result = response.data.result;
  if (!Array.isArray(result)) return null;
  const samples: Sample[] = [];
  for (const entry of result) {
    const metric = (entry as { metric?: Record<string, unknown> })?.metric;
    const pair = (entry as { value?: unknown })?.value;
    const host = cleanText(metric?.host, MAX_LABEL_CHARS);
    const service = cleanText(metric?.service, MAX_LABEL_CHARS);
    const value = Array.isArray(pair) ? Number(pair[1]) : Number.NaN;
    if (!host || !service || !Number.isFinite(value)) continue;
    samples.push({ host, service, value });
  }
  return samples;
};

export type ServiceHealthFetch = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<Pick<Response, 'status' | 'body'>>;

const readCapped = async (body: Response['body']): Promise<string> => {
  if (!body) throw new FeedError('upstream');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FeedError('upstream');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

export interface ServiceHealthFeedOptions {
  /** The `KEY=value` file holding the CF Access service token, reread on each upstream query. */
  envFile: string;
  fetch?: ServiceHealthFetch;
  readFile?: ParObsFileAccess['readFile'];
  fileMode?: ParObsFileAccess['fileMode'];
  /** Where a refused token file is reported, once per distinct reason; console.warn by default. */
  warn?: (line: string) => void;
  baseUrl?: string;
  now?: () => number;
}

const ORDER: Record<ProbeState, number> = { down: 0, 'expected-down': 1, up: 2 };

/**
 * Loader for `/service-health`. It queries par-obs Grafana's Prometheus proxy with the service
 * token, which stays on this Mac, and tracks each probe's last state change between queries.
 */
export const createServiceHealthFeed = (
  options: ServiceHealthFeedOptions,
): (() => Promise<ServiceHealth>) => {
  const fetcher: ServiceHealthFetch =
    options.fetch ?? ((url, init) => fetch(url, init) as Promise<Response>);
  const now = options.now ?? Date.now;
  const baseUrl = URL.parse(options.baseUrl ?? '');
  const seen = new Map<string, { state: ProbeState; since: number; exact: boolean }>();
  let cached: { at: number; value: Promise<ServiceHealth> } | null = null;
  const warn = options.warn ?? ((line: string) => console.warn(line));
  let lastWarning = '';
  const access: ParObsFileAccess = {
    readFile: options.readFile,
    fileMode: options.fileMode,
    warn: (line) => {
      if (line === lastWarning) return;
      lastWarning = line;
      warn(line);
    },
  };

  const query = async (
    base: URL,
    credential: ParObsCredential,
    promql: string,
  ): Promise<Sample[]> => {
    const url = new URL(QUERY_PATH, base);
    url.search = new URLSearchParams({ query: promql }).toString();
    let response: Pick<Response, 'status' | 'body'>;
    try {
      // A redirect (Cloudflare's login page) is never followed: it would carry the token along.
      response = await fetcher(url.href, {
        headers: {
          accept: 'application/json',
          'CF-Access-Client-Id': credential.clientId,
          'CF-Access-Client-Secret': credential.clientSecret,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new FeedError('upstream');
    }
    if (response.status !== 200) {
      // Release the connection rather than leaving an unread body to the garbage collector.
      await response.body?.cancel().catch(() => {});
      throw new FeedError('upstream');
    }
    let body: unknown;
    try {
      body = JSON.parse(await readCapped(response.body));
    } catch {
      throw new FeedError('upstream');
    }
    const samples = parseVector(body);
    if (!samples) throw new FeedError('upstream');
    return samples;
  };

  const load = async (): Promise<ServiceHealth> => {
    if (baseUrl?.protocol !== 'https:' || baseUrl.username || baseUrl.password)
      throw new FeedError('not_configured');
    const credential = loadParObsCredential(options.envFile, access);
    if (!credential) throw new FeedError('not_configured');
    const up = await query(baseUrl, credential, PAR_OBS_UP_QUERY);
    const expected = await query(baseUrl, credential, PAR_OBS_EXPECTED_DOWN_QUERY);
    const canaries = new Set(
      expected.filter((sample) => sample.value >= 1).map((s) => `${s.host}\n${s.service}`),
    );
    const at = now();
    const keys = new Set<string>();
    const probes: ServiceProbe[] = [];
    for (const sample of up) {
      const key = `${sample.host}\n${sample.service}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const state: ProbeState =
        sample.value >= 1 ? 'up' : canaries.has(key) ? 'expected-down' : 'down';
      const previous = seen.get(key);
      const record = !previous
        ? { state, since: at, exact: false }
        : previous.state !== state
          ? { state, since: at, exact: true }
          : previous;
      seen.set(key, record);
      probes.push({
        host: sample.host,
        service: sample.service,
        state,
        since: record.since,
        sinceExact: record.exact,
      });
    }
    for (const key of seen.keys()) if (!keys.has(key)) seen.delete(key);
    probes.sort(
      (a, b) =>
        ORDER[a.state] - ORDER[b.state] ||
        a.service.localeCompare(b.service) ||
        a.host.localeCompare(b.host),
    );
    return {
      now: at,
      probes: probes.slice(0, MAX_PROBES),
      down: probes.filter((probe) => probe.state === 'down').length,
    };
  };

  return () => {
    if (cached && now() - cached.at < RESULT_CACHE_MS) return cached.value;
    const value = load();
    const entry = { at: now(), value };
    cached = entry;
    // A failure is not worth sharing for the whole window; the next poll asks again.
    value.catch(() => {
      if (cached === entry) cached = null;
    });
    return value;
  };
};
