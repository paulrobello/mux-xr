import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { versionManifestPlugin } from './scripts/build-version.ts';
import { sharedCommandsPlugin } from './scripts/publish-commands.ts';

const cert = process.env.MUX_XR_TLS_CERT;
const key = process.env.MUX_XR_TLS_KEY;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;
const version = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [
    versionManifestPlugin(version, fileURLToPath(new URL('./public', import.meta.url))),
    sharedCommandsPlugin(fileURLToPath(new URL('.', import.meta.url))),
  ],
  server: { https, host: '0.0.0.0', port: 4240, strictPort: true },
  preview: { https, host: '0.0.0.0', port: 4240, strictPort: true },
  build: { target: 'es2023', sourcemap: true },
});
