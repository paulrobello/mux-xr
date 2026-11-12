import { accessSync, constants, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { loadClipboardSecret } from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';
import { createDictationTelemetry } from '../src/server/dictation-telemetry';

const required = (args: Map<string, string>, name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
};

const parsed = new Map<string, string>();
const origins: string[] = [];
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith('--') || !value || value.startsWith('--'))
    throw new Error('Arguments must be --name value pairs.');
  if (name === '--origin') origins.push(value);
  else parsed.set(name, value);
}

const host = required(parsed, '--host');
const port = Number(required(parsed, '--port'));
if (origins.length === 0) throw new Error('Missing required argument --origin.');
const cert = required(parsed, '--cert');
const key = required(parsed, '--key');
const model = required(parsed, '--model');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Port must be between 1 and 65535.');

accessSync(model, constants.R_OK);
const telemetry = createDictationTelemetry({
  envFile: parsed.get('--otel-env-file') ?? resolve('.local/whisper-otel.env'),
});
const server = createServer(
  { cert: readFileSync(cert), key: readFileSync(key) },
  (request, response) => {
    try {
      telemetry.httpRequest(
        request.url === '/health' ? '/health' : 'other',
        request.url === '/health' ? 200 : 404,
      );
    } catch {
      /* The health path must remain independent of telemetry. */
    }
    response.setHeader('content-type', 'application/json');
    response.writeHead(request.url === '/health' ? 200 : 404);
    response.end(
      JSON.stringify(
        request.url === '/health' ? { ready: true, engine: 'whisper.cpp' } : { error: 'Not found' },
      ),
    );
  },
);
const clipboardSecretFile = parsed.get('--clipboard-secret-file');
const clipboardAtStart = loadClipboardSecret(clipboardSecretFile);
console.log(
  clipboardAtStart.enabled
    ? 'Clipboard sync enabled.'
    : `Clipboard sync disabled: ${clipboardAtStart.reason}.`,
);
const attached = attachDictationServer(server, {
  allowedOrigins: origins,
  model,
  telemetry,
  clipboard: {
    loadSecret: () => loadClipboardSecret(clipboardSecretFile),
    // Counts and sizes only: clipboard text and the secret never reach the log.
    onEvent: (event) =>
      console.log(
        event.kind === 'transfer'
          ? `Clipboard ${event.direction}: ${event.bytes} bytes`
          : `Clipboard refused: ${event.code}`,
      ),
  },
  // Refusal codes only; successful stats requests are never logged.
  hostStats: { onEvent: (event) => console.log(`Host stats refused: ${event.code}`) },
  ffmpegPath: parsed.get('--ffmpeg') ?? '/opt/homebrew/bin/ffmpeg',
  whisperPath: parsed.get('--whisper') ?? '/opt/homebrew/bin/whisper-cli',
});
server.listen(port, host, () => {
  telemetry.started();
  void telemetry.forceFlush();
  console.log(`Local dictation server listening on ${host}:${port}`);
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await attached.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await telemetry.shutdown();
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
