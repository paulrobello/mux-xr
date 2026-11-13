// Posts one toast to paired Mux XR headsets through the host service's /toast route.
//
//   bun run scripts/send-toast.ts "Build finished" --level success --title CI --timeout 8
//   bun run scripts/send-toast.ts "Deploying" --id deploy --timeout 0
//   bun run scripts/send-toast.ts --dismiss deploy
//
// The pairing secret is read from .local/clipboard-secret (or --secret-file / MUX_XR_SECRET_FILE)
// and sent as a bearer token. Exit status: 0 delivered or queued, 1 refused, 2 bad arguments.
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage: send-toast.ts <message> [--level info|success|warn|error] [--title T]
  [--timeout seconds (0 keeps it)] [--placement top|center|bottom|hud|pane]
  [--pane <id>|current] [--color #rrggbb] [--id ID] [--source S]
  [--url https://host:4242] [--secret-file path] [--insecure]
  send-toast.ts --dismiss <id>`;

const fail = (message: string): never => {
  console.error(`${message}\n${usage}`);
  process.exit(2);
};

const args = process.argv.slice(2);
const options = new Map<string, string>();
const positional: string[] = [];
let insecure = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--insecure') insecure = true;
  else if (argument === '--help' || argument === '-h') {
    console.log(usage);
    process.exit(0);
  } else if (argument.startsWith('--')) {
    const value = args[index + 1];
    if (value === undefined) fail(`${argument} needs a value.`);
    options.set(argument.slice(2), value);
    index += 1;
  } else positional.push(argument);
}

const body: Record<string, unknown> = {};
const dismiss = options.get('dismiss');
if (dismiss) {
  body.id = dismiss;
  body.dismiss = true;
} else {
  if (positional.length !== 1) fail('Give exactly one message (quote it).');
  body.message = positional[0];
  for (const key of ['level', 'title', 'placement', 'color', 'id', 'source'])
    if (options.has(key)) body[key] = options.get(key);
  if (options.has('timeout')) body.timeout = Number(options.get('timeout'));
  const pane = options.get('pane');
  if (pane) {
    body.paneId = pane === 'current' ? process.env.PAR_MUX_PANE_ID : pane;
    if (!body.paneId) fail('--pane current needs PAR_MUX_PANE_ID (run it inside a par-mux pane).');
    body.placement ??= 'pane';
  }
}

const url = new URL('/toast', options.get('url') ?? 'https://localhost:4242');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const secretFile =
  options.get('secret-file') ??
  process.env.MUX_XR_SECRET_FILE ??
  resolve(repoRoot, '.local/clipboard-secret');
const readSecret = (): string => {
  try {
    return readFileSync(secretFile, 'utf8').trim();
  } catch {
    return fail(`Cannot read the pairing secret at ${secretFile}.`);
  }
};
const secret = readSecret();
const payload = JSON.stringify(body);
const req = request(
  url,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
    // The host service uses a local development certificate; trust it on this Mac only unless asked.
    rejectUnauthorized: !(loopback || insecure),
    timeout: 5_000,
  },
  (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (response.statusCode === 202) {
        const { id, delivered } = JSON.parse(text) as { id: string; delivered: number };
        console.log(
          delivered
            ? `Toast ${id} delivered to ${delivered} headset${delivered === 1 ? '' : 's'}.`
            : `Toast ${id} queued; no headset is subscribed right now.`,
        );
        process.exit(0);
      }
      let reason = text;
      try {
        reason = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* Plain-text body. */
      }
      console.error(`Refused (${response.statusCode}): ${reason}`);
      process.exit(1);
    });
  },
);
req.on('timeout', () => req.destroy(new Error('timed out')));
req.on('error', (error) => {
  console.error(`Could not reach ${url.origin}: ${error.message}`);
  process.exit(1);
});
req.end(payload);
