import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const cert = process.env.MUX_XR_TLS_CERT;
const key = process.env.MUX_XR_TLS_KEY;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;

export default defineConfig({
  server: { https, host: '0.0.0.0', port: 4240, strictPort: true },
  preview: { https, host: '0.0.0.0', port: 4240, strictPort: true },
  build: { target: 'es2023', sourcemap: true },
});
