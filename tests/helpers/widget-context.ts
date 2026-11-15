/** A `WidgetContext` over a fake host, so widget tests need no module mocking. */
import type { PairedSocketOptions } from '../../src/host-pairing';
import { createWidgetChannels, type WidgetContext } from '../../src/xr/widget-types';

export interface FakeHostRequest {
  url: string;
  protocol: string;
  material: string;
}

/**
 * A host that answers nothing: every paired request is recorded in `requests` and stays pending.
 * `secret` defaults to a paired device so feed widgets issue requests.
 */
export function createFakeHost(secret: string | null = 'test-secret') {
  const requests: FakeHostRequest[] = [];
  const host: WidgetContext['host'] = {
    url: (path) => `ws://host.test${path}`,
    secret: () => secret,
    openPaired: ((options: PairedSocketOptions<unknown, string>) => {
      requests.push({ url: options.url, protocol: options.protocol, material: options.material });
      return new Promise(() => undefined);
    }) as WidgetContext['host']['openPaired'],
  };
  return { host, requests };
}

/** A context with fresh channels and a recording fake host; pass overrides to inject a different host. */
export function createTestWidgetContext(overrides: Partial<WidgetContext> = {}) {
  const fake = createFakeHost();
  const channels = createWidgetChannels({ bellFeed: [], textureAnisotropy: 1, weatherZip: '' });
  const context: WidgetContext = {
    envMap: null,
    host: fake.host,
    channels,
    ...overrides,
  };
  return { context, channels, requests: fake.requests };
}
