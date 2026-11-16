import { createHostClipboardSecretStore } from '../host-clipboard';
import { openPairedSocket, type PairedHost } from '../host-pairing';
import { hostServiceUrl } from '../host-service';

/** The production host connection: the host service port on the page's host, paired by the stored secret. */
export function createBrowserHost(): PairedHost {
  const secret = createHostClipboardSecretStore();
  return {
    url: (path) => hostServiceUrl(path, window.location),
    secret: () => secret.get(),
    openPaired: openPairedSocket,
  };
}
