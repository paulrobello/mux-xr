/** Builds each host-backed widget's data source from the scene's host connection. */
import { createHostFeedClient, type HostFeedSource } from '../host-feed';
import type { PairedHost } from '../host-pairing';
import { createRepoStatusClient, type RepoStatusFetcher } from '../host-repo-status';
import { createHostStatsClient, type HostStatsSource } from '../host-stats';
import { createWeatherClient } from '../host-weather';

/** A feed client on the host service's `path`. */
export function hostFeedSource<T>(
  host: PairedHost,
  path: string,
  protocol: string,
  parse: (data: unknown) => T | null,
): HostFeedSource<T> {
  return createHostFeedClient({
    protocol,
    parse,
    url: () => host.url(path),
    secret: host.secret,
    openPaired: host.openPaired,
  });
}

export function hostStatsSource(host: PairedHost): HostStatsSource {
  return createHostStatsClient({
    url: () => host.url('/host-stats'),
    secret: host.secret,
    openPaired: host.openPaired,
  });
}

export function repoStatusFetcher(host: PairedHost): RepoStatusFetcher {
  return createRepoStatusClient({
    url: () => host.url('/repo-status'),
    secret: host.secret,
    openPaired: host.openPaired,
  });
}

export function weatherFetcher(host: PairedHost): ReturnType<typeof createWeatherClient> {
  return createWeatherClient({
    url: () => host.url('/weather'),
    secret: host.secret,
    openPaired: host.openPaired,
  });
}
