import { describe, expect, test } from 'vitest';
import {
  buildCoreReleaseJson,
  expectedFromChecksums,
  expectedFromSidecar,
  extractMinisignKey,
  requiredAssetsFor,
  scanPinFiles,
  tagFor,
  versionFor,
} from '../scripts/core-pin';

// Shape of the printf line in core's scripts/check-release-signatures.sh, with literal \n escapes.
const RELEASE_SCRIPT = [
  `repo_root=$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)`,
  'pub=$(mktemp)',
  String.raw`printf 'untrusted comment: minisign public key 7D5A457F1AB85B55\nRWRVW7gaf0VafV4bihSeMbq2JiaTYTanOpdm5EkgpPk65edfjHsAnA+t\n' >"$pub"`,
].join('\n');

describe('release tag formatting', () => {
  test('tagFor and versionFor are inverse and idempotent', () => {
    expect(tagFor('0.89.0')).toBe('v0.89.0');
    expect(tagFor(tagFor('0.89.0'))).toBe('v0.89.0');
    expect(tagFor('v0.89.0')).toBe('v0.89.0');
    expect(versionFor('v0.89.0')).toBe('0.89.0');
    expect(versionFor(versionFor('v0.89.0'))).toBe('0.89.0');
    expect(versionFor('0.89.0')).toBe('0.89.0');
    expect(versionFor(tagFor('0.90.1'))).toBe('0.90.1');
    expect(tagFor(versionFor('v0.90.1'))).toBe('v0.90.1');
  });
});

describe('SHA256SUMS parsing', () => {
  const sums = [
    '8602bca5678b4ca71944f5c8ed6814257a5e3b5059ac869f49db155f5f0dac87  par-mux-v0.89.0-aarch64-apple-darwin.tar.gz',
    '57de43ffdb9a85942a208a49a35a50244f1a5c2f58e3e1de8f23a1d0cfa666c7\tpar-term-streamer-mux-macos-aarch64',
    '',
  ].join('\n');

  test('finds the named asset with space or tab separators', () => {
    expect(expectedFromChecksums(sums, 'par-mux-v0.89.0-aarch64-apple-darwin.tar.gz')).toBe(
      '8602bca5678b4ca71944f5c8ed6814257a5e3b5059ac869f49db155f5f0dac87',
    );
    expect(expectedFromChecksums(sums, 'par-term-streamer-mux-macos-aarch64')).toBe(
      '57de43ffdb9a85942a208a49a35a50244f1a5c2f58e3e1de8f23a1d0cfa666c7',
    );
  });

  test('throws naming the asset when it is absent', () => {
    expect(() =>
      expectedFromChecksums(sums, 'par-mux-v0.90.0-aarch64-apple-darwin.tar.gz'),
    ).toThrow(/par-mux-v0\.90\.0-aarch64-apple-darwin\.tar\.gz/);
  });
});

describe('streamer sha256 sidecar parsing', () => {
  test('returns the first whitespace-separated token', () => {
    expect(expectedFromSidecar('57de43ffdb  par-term-streamer-mux-macos-aarch64\n')).toBe(
      '57de43ffdb',
    );
    expect(expectedFromSidecar('  57de43ffdb\ttrailing\n')).toBe('57de43ffdb');
  });

  test('throws on a sidecar without a hash', () => {
    expect(() => expectedFromSidecar('')).toThrow(/no hash/);
    expect(() => expectedFromSidecar('   \n')).toThrow(/no hash/);
  });
});

describe('minisign key extraction', () => {
  test('extracts the comment and key from the printf line', () => {
    const key = extractMinisignKey(RELEASE_SCRIPT);
    expect(key.comment).toBe('untrusted comment: minisign public key 7D5A457F1AB85B55');
    expect(key.key).toBe('RWRVW7gaf0VafV4bihSeMbq2JiaTYTanOpdm5EkgpPk65edfjHsAnA+t');
  });

  test('throws when the script has no pinned key', () => {
    expect(() => extractMinisignKey('#!/bin/sh\necho nothing to see')).toThrow(
      /minisign public key/,
    );
  });
});

describe('pin-file scan', () => {
  test('reports one line per stale file and keeps historical reviews', () => {
    const docs: Record<string, string> = {
      'README.md': 'Mux XR pins core 0.89.0 through core-release.json.',
      'docs/HOST-SETUP.md': '[core-release.json](../core-release.json) pins par-term core 0.89.0.',
      'src/terminal/vendor/README.md': 'Vendored from the v0.89.0 tag, commit bf095c0f.',
      'docs/core-0.89.0-review.md': '# par-term emu core 0.89.0 review',
      'docs/TESTING.md': 'No version token in this file.',
    };
    expect(scanPinFiles(docs, '0.89.0')).toEqual([
      { file: 'README.md', text: 'Mux XR pins core 0.89.0 through core-release.json.' },
      {
        file: 'docs/HOST-SETUP.md',
        text: '[core-release.json](../core-release.json) pins par-term core 0.89.0.',
      },
      {
        file: 'src/terminal/vendor/README.md',
        text: 'Vendored from the v0.89.0 tag, commit bf095c0f.',
      },
    ]);
  });
});

describe('required release assets', () => {
  test('checksums the mux archive through SHA256SUMS, not a .sha256 sidecar', () => {
    const required = requiredAssetsFor('v0.89.0');
    expect(required).toContain('par-mux-v0.89.0-aarch64-apple-darwin.tar.gz');
    expect(required).toContain('par-mux-v0.89.0-aarch64-apple-darwin.tar.gz.minisig');
    expect(required).toContain('par-mux-v0.89.0-SHA256SUMS.txt');
    expect(required).toContain('par-term-streamer-mux-macos-aarch64');
    expect(required).toContain('par-term-streamer-mux-macos-aarch64.sha256');
    expect(required).toContain('par-term-streamer-mux-macos-aarch64.minisig');
    expect(required).not.toContain('par-mux-v0.89.0-aarch64-apple-darwin.tar.gz.sha256');
  });
});

describe('core-release.json content', () => {
  test('reproduces the pinned shape exactly', () => {
    const json = buildCoreReleaseJson({
      version: '0.90.0',
      commit: 'bf095c0fee7a11f9ddd8700c895485cfe2f648fd',
      streamer: { asset: 'par-term-streamer-mux-macos-aarch64', sha256: '57de43ff' },
      muxArchive: { asset: 'par-mux-v0.90.0-aarch64-apple-darwin.tar.gz', sha256: '8602bca5' },
      binding: { sha256: '149c4be5' },
    });
    const expected = `{
  "version": "0.90.0",
  "commit": "bf095c0fee7a11f9ddd8700c895485cfe2f648fd",
  "releaseUrl": "https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.90.0",
  "macosArm64": {
    "streamer": {
      "asset": "par-term-streamer-mux-macos-aarch64",
      "sha256": "57de43ff"
    },
    "muxArchive": {
      "asset": "par-mux-v0.90.0-aarch64-apple-darwin.tar.gz",
      "sha256": "8602bca5"
    }
  },
  "generatedProtocol": {
    "path": "web-terminal-frontend/lib/proto/terminal_pb.ts",
    "sha256": "149c4be5"
  }
}
`;
    expect(json).toBe(expected);
  });
});
