import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export function buildFingerprint(
  entries: Array<[string, string | Uint8Array]>,
  version: string,
  publicDirectory: string,
): string {
  const files = [...entries];
  const visit = (directory: string, prefix = 'public'): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const name = `${prefix}/${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, name);
      else if (entry.isFile()) files.push([name, readFileSync(path)]);
    }
  };
  if (existsSync(publicDirectory)) visit(publicDirectory);
  const hash = createHash('sha256').update(version).update('\0');
  for (const [name, contents] of files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    hash.update(name).update('\0').update(contents).update('\0');
  return hash.digest('hex');
}

export function versionManifestPlugin(version: string, publicDirectory: string): Plugin {
  return {
    name: 'mux-xr-build-version',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entries: Array<[string, string | Uint8Array]> = Object.entries(bundle)
        .filter(([name]) => !name.endsWith('.map'))
        .map(([name, entry]) => [name, entry.type === 'chunk' ? entry.code : entry.source]);
      const buildId = buildFingerprint(entries, version, publicDirectory);
      const html = bundle['index.html'];
      if (html?.type !== 'asset') throw new Error('Build version requires index.html');
      const source =
        typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString('utf8');
      html.source = source.replace(
        '</head>',
        `<meta name="build-fingerprint" content="${buildId}"></head>`,
      );
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, version }),
      });
    },
  };
}
