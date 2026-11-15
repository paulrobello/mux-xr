/** Decision for a `?server=` link parameter: auto-connect, or only prefill the endpoint field. */
export type ServerParamDecision = 'connect' | 'prefill';

/**
 * A `server` query parameter arrives from a link, so it may only auto-connect when it
 * names the page's own host or the saved endpoint the user connected to before.
 * Compare host (hostname plus port): a different port can be a different service.
 * Anything else, including an unparseable value, only prefills the endpoint field.
 */
export const classifyServerParam = (
  value: string,
  pageHost: string,
  savedEndpoint: string,
): ServerParamDecision => {
  let host: string;
  try {
    host = new URL(value, `wss://${pageHost}`).host;
  } catch {
    return 'prefill';
  }
  if (host === pageHost) return 'connect';
  if (!savedEndpoint) return 'prefill';
  try {
    return new URL(savedEndpoint, `wss://${pageHost}`).host === host ? 'connect' : 'prefill';
  } catch {
    return 'prefill';
  }
};
