/** The host service (the dictation server's WebSocket routes) shared by every browser client. */

export const HOST_SERVICE_PORT = 4242;

/**
 * The host service port for a page, honouring a `host-port` query parameter override so a private
 * fixture can run the service on another port without a build step. Anything but an integer 1-65535
 * falls back to the default.
 */
export function hostServicePort(location: { href: string }): number {
  const override = new URL(location.href).searchParams.get('host-port');
  const port = override !== null && /^\d+$/.test(override) ? Number.parseInt(override, 10) : 0;
  return port >= 1 && port <= 65535 ? port : HOST_SERVICE_PORT;
}

/** The host service's URL for `path`: the page's host on the service port, over WebSocket. */
export function hostServiceUrl(
  path: string,
  location: { href: string; protocol: string },
  port = hostServicePort(location),
): string {
  const url = new URL(path, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.port = String(port);
  url.search = '';
  url.hash = '';
  return url.href;
}
