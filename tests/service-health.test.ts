import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type { HostFeedResult, HostFeedSource } from '../src/host-feed';
import type { FeedEvent } from '../src/server/feed-route';
import {
  createServiceHealthFeed,
  loadParObsCredential,
  PAR_OBS_EXPECTED_DOWN_QUERY,
  PAR_OBS_UP_QUERY,
  SERVICE_HEALTH_PROTOCOL,
  type ServiceHealthFetch,
} from '../src/server/service-health';
import { PERF_TONE_COLORS } from '../src/xr/perf-gauge';
import {
  createServiceHealthWidget,
  formatAge,
  parseServiceHealth,
  SERVICE_HEALTH_POLL_MS,
  type ServiceHealth,
  serviceHealthView,
} from '../src/xr/service-health';
import {
  clientRequest,
  requestFeed,
  startFeedServer,
  stopFeedServers,
} from './helpers/feed-socket';

afterEach(stopFeedServers);

const NOW = Date.UTC(2026, 10, 12, 5, 40);
const MIN = 60_000;
const CLIENT_ID = 'test-client-id-not-real.access';
const CLIENT_SECRET = 'test-client-value-not-real-0123456789';
const ENV_TEXT = [
  '# par-obs read-only query token',
  `export PAR_OBS_CF_ACCESS_CLIENT_ID="${CLIENT_ID}"`,
  `PAR_OBS_CF_ACCESS_CLIENT_SECRET='${CLIENT_SECRET}'`,
  'OTHER_KEY=ignored',
].join('\n');
const ENV_FILE = '/owner/.local/par-obs-query.env';
const readEnv = (path: string): string => {
  if (path !== ENV_FILE) throw new Error('ENOENT');
  return ENV_TEXT;
};
const ownerOnly = (path: string): number => {
  if (path !== ENV_FILE) throw new Error('ENOENT');
  return 0o100600;
};
const io = { readFile: readEnv, fileMode: ownerOnly, baseUrl: 'https://grafana.example.test' };
const textFile = (text: string) => ({ readFile: () => text, fileMode: ownerOnly });

const vector = (rows: Array<[string, string, number]>) => ({
  status: 'success',
  data: {
    resultType: 'vector',
    result: rows.map(([host, service, value]) => ({
      metric: { host, service, job: 'par-obs-prober' },
      value: [NOW / 1000, String(value)],
    })),
  },
});
const bodyOf = (text: string): ReadableStream<Uint8Array<ArrayBuffer>> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

type Call = { url: URL; init: Parameters<ServiceHealthFetch>[1] };
const fakeParObs = (answers: { up: unknown; expected?: unknown; status?: number }) => {
  const calls: Call[] = [];
  const fetch: ServiceHealthFetch = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const query = parsed.searchParams.get('query');
    const body = query === PAR_OBS_UP_QUERY ? answers.up : (answers.expected ?? vector([]));
    return {
      status: answers.status ?? 200,
      body: bodyOf(typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { calls, fetch };
};

describe('par-obs credential file', () => {
  it('reads only the two CF Access keys, with or without quotes or export', () => {
    expect(loadParObsCredential(ENV_FILE, io)).toEqual({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
  });

  it('answers null for a missing file, a missing key or a value unfit for a header', () => {
    expect(loadParObsCredential('/missing', io)).toBeNull();
    expect(
      loadParObsCredential(ENV_FILE, textFile(`PAR_OBS_CF_ACCESS_CLIENT_ID=${CLIENT_ID}`)),
    ).toBeNull();
    expect(
      loadParObsCredential(
        ENV_FILE,
        textFile(
          `PAR_OBS_CF_ACCESS_CLIENT_ID=a b\nPAR_OBS_CF_ACCESS_CLIENT_SECRET=${CLIENT_SECRET}`,
        ),
      ),
    ).toBeNull();
  });

  it('refuses a file group or others can access, naming the path and mode but not the contents', async () => {
    const lines: string[] = [];
    for (const mode of [0o100644, 0o100640, 0o100604, 0o100660]) {
      const access = {
        readFile: readEnv,
        fileMode: () => mode,
        warn: (line: string) => lines.push(line),
      };
      expect(loadParObsCredential(ENV_FILE, access), mode.toString(8)).toBeNull();
    }
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(ENV_FILE);
    expect(lines[0]).toContain('mode 644');
    expect(lines.join('\n')).not.toContain(CLIENT_SECRET);
    expect(lines.join('\n')).not.toContain(CLIENT_ID);

    const warned: string[] = [];
    const { calls, fetch } = fakeParObs({ up: vector([]) });
    const feed = createServiceHealthFeed({
      envFile: ENV_FILE,
      readFile: readEnv,
      fileMode: () => 0o100644,
      baseUrl: io.baseUrl,
      warn: (line) => warned.push(line),
      fetch,
    });
    await expect(feed()).rejects.toMatchObject({ code: 'not_configured' });
    await expect(feed()).rejects.toMatchObject({ code: 'not_configured' });
    expect(warned).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('checks the real file mode by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mux-xr-par-obs-'));
    const file = join(dir, 'par-obs-query.env');
    try {
      writeFileSync(file, ENV_TEXT, { mode: 0o644 });
      chmodSync(file, 0o644);
      expect(loadParObsCredential(file, { warn: () => undefined })).toBeNull();
      chmodSync(file, 0o600);
      expect(loadParObsCredential(file)).toEqual({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('service health feed', () => {
  it('asks the Grafana datasource proxy with the token in headers and never follows redirects', async () => {
    const { calls, fetch } = fakeParObs({ up: vector([['build-host-2', 'kanban', 1]]) });
    await createServiceHealthFeed({
      envFile: ENV_FILE,
      ...io,
      fetch,
      now: () => NOW,
    })();
    expect(calls.map((call) => call.url.searchParams.get('query'))).toEqual([
      PAR_OBS_UP_QUERY,
      PAR_OBS_EXPECTED_DOWN_QUERY,
    ]);
    const [first] = calls;
    expect(first?.url.origin).toBe(io.baseUrl);
    expect(first?.url.pathname).toBe('/api/datasources/proxy/uid/prometheus/api/v1/query');
    expect(first?.url.href).not.toContain(CLIENT_SECRET);
    expect(first?.init.redirect).toBe('manual');
    expect(first?.init.headers).toMatchObject({
      'CF-Access-Client-Id': CLIENT_ID,
      'CF-Access-Client-Secret': CLIENT_SECRET,
    });
    expect(PAR_OBS_UP_QUERY).toBe('min by (host, service) (last_over_time(par_obs_up[5m]))');
  });

  it('orders down probes first, keeps canaries apart, and tracks each change on the streamer', async () => {
    let now = NOW;
    let up: Array<[string, string, number]> = [
      ['build-host-2', 'kanban', 1],
      ['test-mac', 'ollama', 0],
      ['build-host-1', 'red-path', 0],
    ];
    const fetch: ServiceHealthFetch = async (url) => {
      const query = new URL(url).searchParams.get('query');
      const body =
        query === PAR_OBS_UP_QUERY ? vector(up) : vector([['build-host-1', 'red-path', 1]]);
      return { status: 200, body: bodyOf(JSON.stringify(body)) };
    };
    const feed = createServiceHealthFeed({
      envFile: ENV_FILE,
      ...io,
      fetch,
      now: () => now,
    });
    const first = await feed();
    expect(first.down).toBe(1);
    expect(first.probes.map((probe) => [probe.service, probe.state, probe.sinceExact])).toEqual([
      ['ollama', 'down', false],
      ['red-path', 'expected-down', false],
      ['kanban', 'up', false],
    ]);
    now += 5 * MIN;
    up = [
      ['build-host-2', 'kanban', 1],
      ['test-mac', 'ollama', 1],
      ['build-host-1', 'red-path', 0],
    ];
    const second = await feed();
    expect(second.down).toBe(0);
    const ollama = second.probes.find((probe) => probe.service === 'ollama');
    expect(ollama).toMatchObject({ state: 'up', since: NOW + 5 * MIN, sinceExact: true });
    const kanban = second.probes.find((probe) => probe.service === 'kanban');
    expect(kanban).toMatchObject({ since: NOW, sinceExact: false });
  });

  it('shares one answer for 30 seconds but retries at once after a failure', async () => {
    let now = NOW;
    let failing = true;
    let count = 0;
    const fetch: ServiceHealthFetch = async () => {
      count += 1;
      if (failing) throw new Error('connect ECONNREFUSED');
      return { status: 200, body: bodyOf(JSON.stringify(vector([['build-host-2', 'kanban', 1]]))) };
    };
    const feed = createServiceHealthFeed({
      envFile: ENV_FILE,
      ...io,
      fetch,
      now: () => now,
    });
    await expect(feed()).rejects.toMatchObject({ code: 'upstream' });
    failing = false;
    await feed();
    const afterSuccess = count;
    now += 29_000;
    await feed();
    expect(count).toBe(afterSuccess);
    now += 2_000;
    await feed();
    expect(count).toBeGreaterThan(afterSuccess);
  });

  it('answers not configured without the token file and upstream for any par-obs failure', async () => {
    const missing = fakeParObs({ up: vector([]) });
    await expect(
      createServiceHealthFeed({ envFile: '/missing', ...io, fetch: missing.fetch })(),
    ).rejects.toMatchObject({ code: 'not_configured' });
    expect(missing.calls).toHaveLength(0);
    for (const answers of [
      { up: vector([]), status: 302 },
      { up: vector([]), status: 500 },
      { up: 'not json' },
      { up: { status: 'error', error: 'bad query' } },
      { up: { ...vector([]), padding: 'x'.repeat(600 * 1024) } },
    ]) {
      const { fetch } = fakeParObs(answers);
      await expect(
        createServiceHealthFeed({ envFile: ENV_FILE, ...io, fetch })(),
      ).rejects.toMatchObject({ code: 'upstream' });
    }
  });

  it('cancels the body of a refused par-obs answer before giving up', async () => {
    let cancelled = 0;
    const fetch: ServiceHealthFetch = async () => ({
      status: 302,
      body: new ReadableStream<Uint8Array<ArrayBuffer>>({
        cancel() {
          cancelled += 1;
        },
      }),
    });
    await expect(
      createServiceHealthFeed({ envFile: ENV_FILE, ...io, fetch })(),
    ).rejects.toMatchObject({ code: 'upstream' });
    expect(cancelled).toBe(1);
  });

  it('serves /service-health behind its own flag and the secret, and the token never leaves', async () => {
    const events: FeedEvent[] = [];
    const { fetch } = fakeParObs({ up: vector([['test-mac', 'ollama', 0]]) });
    const on = await startFeedServer({
      serviceHealth: {
        enabled: true,
        envFile: ENV_FILE,
        ...io,
        fetch,
        onEvent: (event) => events.push(event),
      },
    });
    const { reply } = await requestFeed(`${on.base}/service-health`, SERVICE_HEALTH_PROTOCOL, '{}');
    expect(reply).toMatchObject({ type: 'feed', data: { down: 1 } });
    expect(JSON.stringify(reply)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(reply)).not.toContain(CLIENT_ID);
    const parsed = await clientRequest(
      `${on.base}/service-health`,
      SERVICE_HEALTH_PROTOCOL,
      (data) => parseServiceHealth(data, NOW),
      '{}',
    );
    expect(parsed.ok && parsed.value.probes[0]).toMatchObject({ service: 'ollama', state: 'down' });

    const unset = await startFeedServer({
      serviceHealth: {
        enabled: true,
        envFile: '/missing',
        ...io,
        fetch,
        onEvent: (event) => events.push(event),
      },
    });
    expect(
      await clientRequest(
        `${unset.base}/service-health`,
        SERVICE_HEALTH_PROTOCOL,
        parseServiceHealth,
        '{}',
      ),
    ).toEqual({ ok: false, code: 'not-configured' });

    const broken = await startFeedServer({
      serviceHealth: {
        enabled: true,
        envFile: ENV_FILE,
        ...io,
        fetch: async () => {
          throw new Error(`refused for ${CLIENT_SECRET}`);
        },
        onEvent: (event) => events.push(event),
      },
    });
    expect(
      await clientRequest(
        `${broken.base}/service-health`,
        SERVICE_HEALTH_PROTOCOL,
        parseServiceHealth,
        '{}',
      ),
    ).toEqual({ ok: false, code: 'upstream' });
    expect(JSON.stringify(events)).not.toContain(CLIENT_SECRET);

    const off = await startFeedServer({
      serviceHealth: { enabled: false, envFile: ENV_FILE, ...io, fetch },
    });
    expect(
      await clientRequest(
        `${off.base}/service-health`,
        SERVICE_HEALTH_PROTOCOL,
        parseServiceHealth,
        '{}',
      ),
    ).toEqual({ ok: false, code: 'disabled' });
    const unwired = await startFeedServer({});
    expect(
      await clientRequest(
        `${unwired.base}/service-health`,
        SERVICE_HEALTH_PROTOCOL,
        parseServiceHealth,
        '{}',
      ),
    ).toEqual({ ok: false, code: 'disabled' });
  });
});

const serverAnswer = {
  now: NOW,
  down: 1,
  probes: [
    { host: 'test-mac', service: 'ollama', state: 'down', since: NOW - 7 * MIN, sinceExact: true },
    {
      host: 'build-host-1',
      service: 'red-path',
      state: 'expected-down',
      since: NOW - 90 * MIN,
      sinceExact: false,
    },
    {
      host: 'build-host-2',
      service: 'kanban\u0007',
      state: 'up',
      since: NOW - 3 * MIN,
      sinceExact: false,
    },
    { host: 'build-host-2', service: 'bad', state: 'sideways', since: NOW },
  ],
};

describe('service health view', () => {
  it('rebuilds the answer with ages against the streamer clock, dropping bad rows', () => {
    const health = parseServiceHealth(serverAnswer, 5) as ServiceHealth;
    expect(health.receivedAt).toBe(5);
    expect(health.probes).toEqual([
      { host: 'test-mac', service: 'ollama', state: 'down', ageMs: 7 * MIN, exact: true },
      {
        host: 'build-host-1',
        service: 'red-path',
        state: 'expected-down',
        ageMs: 90 * MIN,
        exact: false,
      },
      { host: 'build-host-2', service: 'kanban', state: 'up', ageMs: 3 * MIN, exact: false },
    ]);
    expect(parseServiceHealth({ probes: [] })).toBeNull();
  });

  it('formats ages, marking ones the streamer only knows as a lower bound', () => {
    expect(formatAge(30_000)).toBe('<1m');
    expect(formatAge(7 * MIN)).toBe('7m');
    expect(formatAge(125 * MIN)).toBe('2h 5m');
    expect(formatAge(120 * MIN)).toBe('2h');
    expect(formatAge(3 * 24 * 60 * MIN)).toBe('3d');
    expect(formatAge(3 * MIN, false)).toBe('≥3m');
    expect(formatAge(10_000, false)).toBe('≥1m');
  });

  it('goes red with a down probe, green when all are up, and names every failure', () => {
    const health = parseServiceHealth(serverAnswer, NOW) as ServiceHealth;
    const view = serviceHealthView({ kind: 'health', health }, NOW + 2 * MIN);
    expect(view.tone).toBe('bad');
    expect(view.header).toBe('Service health · 1 down');
    expect(view.rows.map((row) => [row.label, row.stateText, row.age])).toEqual([
      ['ollama · test-mac', 'down', '9m'],
      ['red-path · build-host-1', 'canary', '≥1h 32m'],
      ['kanban · build-host-2', 'up', '≥5m'],
    ]);
    const allUp = parseServiceHealth(
      { now: NOW, probes: [{ host: 'h', service: 's', state: 'up', since: NOW }] },
      NOW,
    ) as ServiceHealth;
    expect(serviceHealthView({ kind: 'health', health: allUp }, NOW)).toMatchObject({
      tone: 'good',
      header: 'Service health · 1 up',
    });
    expect(serviceHealthView({ kind: 'failed', code: 'unavailable' }, NOW)).toMatchObject({
      tone: 'unknown',
      message: 'Host service unreachable (port 4242)',
    });
    expect(serviceHealthView({ kind: 'failed', code: 'upstream' }, NOW).message).toBe(
      'par-obs unreachable from the host',
    );
    expect(serviceHealthView({ kind: 'failed', code: 'not-configured' }, NOW).message).toMatch(
      /token not set up/,
    );
    expect(serviceHealthView({ kind: 'failed', code: 'disabled' }, NOW).message).toBe(
      'Service health is off on the host',
    );
  });
});

describe('service health widget', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  };

  it('turns the header band red while a probe is down and polls once a minute', async () => {
    let now = NOW;
    const calls: Array<(result: HostFeedResult<ServiceHealth>) => void> = [];
    const source: HostFeedSource<ServiceHealth> = () =>
      new Promise((resolve) => {
        calls.push(resolve);
      });
    const widget = createServiceHealthWidget(null, {
      source,
      retryStore: memory,
      firstPollDelayMs: 0,
      now: () => now,
    });
    new THREE.Scene().add(widget.root);
    const band = widget.root.getObjectByName('service-health-band') as THREE.Mesh;
    const color = () => (band.material as THREE.MeshBasicMaterial).color.getHex();
    widget.update(now);
    expect(calls).toHaveLength(1);
    calls[0]?.({ ok: true, value: parseServiceHealth(serverAnswer, now) as ServiceHealth });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(color()).toBe(PERF_TONE_COLORS.bad);
    expect(widget.root.getObjectByName('service-health-row-1-down')?.visible).toBe(true);
    expect(widget.root.getObjectByName('service-health-row-1-up')?.visible).toBe(false);
    expect(widget.root.getObjectByName('service-health-row-2-canary')?.visible).toBe(true);
    expect(widget.root.getObjectByName('service-health-row-4-label')?.visible).toBe(false);
    const age = () => widget.root.getObjectByName('service-health-row-1-age')?.userData.labelText;
    expect(age()).toBe('7m');
    now = NOW + 2 * MIN;
    widget.update(now);
    expect(age()).toBe('9m');
    expect(calls).toHaveLength(2);
    calls[1]?.({ ok: false, code: 'unavailable' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(color()).toBe(PERF_TONE_COLORS.unknown);
    expect(widget.root.getObjectByName('service-health-row-1-label')?.visible).toBe(false);
    expect(widget.root.getObjectByName('service-health-message')?.userData.labelText).toBe(
      'Host service unreachable (port 4242)',
    );
    widget.update(now + SERVICE_HEALTH_POLL_MS - 1);
    expect(calls).toHaveLength(2);
    widget.update(now + SERVICE_HEALTH_POLL_MS);
    expect(calls).toHaveLength(3);
    widget.dispose();
    widget.update(now + 10 * SERVICE_HEALTH_POLL_MS);
    expect(calls).toHaveLength(3);
  });
});
