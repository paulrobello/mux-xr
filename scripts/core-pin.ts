// core-pin fetches and verifies a par-term-emu-core-rust release for pinning in mux-xr.
// Hash, minisign and codesign gates all pass before anything is staged; push, LAN streamer
// rotation and daemon restarts stay owner-gated (docs/TESTING.md, "Private real-streamer checks").
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CORE_REPO = 'paulrobello/par-term-emu-core-rust';
const RELEASE_URL_BASE = `https://github.com/${CORE_REPO}/releases/tag`;
const BINDING_PATH = 'web-terminal-frontend/lib/proto/terminal_pb.ts';
const VENDORED_BINDING = 'src/terminal/vendor/terminal_pb.ts';
const STREAMER_ASSET = 'par-term-streamer-mux-macos-aarch64';
const PIN_SCAN_FILES = [
  'README.md',
  'docs/TESTING.md',
  'docs/HOST-SETUP.md',
  'src/terminal/vendor/README.md',
];
const HISTORICAL_REVIEW = /^docs\/core-\d+\.\d+\.\d+-review\.md$/;

export interface AssetPin {
  asset: string;
  sha256: string;
}

export interface MinisignKey {
  comment: string;
  key: string;
}

export interface PinUpdate {
  file: string;
  text: string;
}

export interface CoreReleaseInput {
  version: string;
  commit: string;
  streamer: AssetPin;
  muxArchive: AssetPin;
  binding: { sha256: string };
}

export function tagFor(version: string): string {
  return /^v\d/.test(version) ? version : `v${version}`;
}

export function versionFor(tag: string): string {
  return /^v\d/.test(tag) ? tag.slice(1) : tag;
}

export function expectedFromChecksums(text: string, asset: string): string {
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === asset) return hash;
  }
  throw new Error(`core-pin: SHA256SUMS.txt has no entry for ${asset}`);
}

export function expectedFromSidecar(text: string): string {
  const token = text.trim().split(/\s+/)[0];
  if (!token) throw new Error('core-pin: sha256 sidecar contains no hash');
  return token;
}

export function extractMinisignKey(scriptText: string): MinisignKey {
  const match = scriptText.match(
    /untrusted comment: minisign public key ([0-9A-Fa-f]+)(?:\\n|\n)(RWR[A-Za-z0-9+/]+)/,
  );
  if (!match)
    throw new Error('core-pin: check-release-signatures.sh has no minisign public key printf line');
  return { comment: `untrusted comment: minisign public key ${match[1]}`, key: match[2] };
}

export function scanPinFiles(docs: Record<string, string>, prevVersion: string): PinUpdate[] {
  const updates: PinUpdate[] = [];
  for (const [file, content] of Object.entries(docs)) {
    if (HISTORICAL_REVIEW.test(file)) continue;
    for (const line of content.split('\n')) {
      if (line.includes(prevVersion)) {
        updates.push({ file, text: line });
        break;
      }
    }
  }
  return updates;
}

export function buildCoreReleaseJson(input: CoreReleaseInput): string {
  const release = {
    version: input.version,
    commit: input.commit,
    releaseUrl: `${RELEASE_URL_BASE}/${tagFor(input.version)}`,
    macosArm64: {
      streamer: { asset: input.streamer.asset, sha256: input.streamer.sha256 },
      muxArchive: { asset: input.muxArchive.asset, sha256: input.muxArchive.sha256 },
    },
    generatedProtocol: { path: BINDING_PATH, sha256: input.binding.sha256 },
  };
  return `${JSON.stringify(release, null, 2)}\n`;
}

interface RunResult {
  ok: boolean;
  output: string;
}

function run(command: string, args: string[]): RunResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) return { ok: false, output: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      output:
        [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `exit ${result.status}`,
    };
  }
  return { ok: true, output: result.stdout.trim() };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fetchRepoFile(path: string, ref: string): Buffer {
  const result = run('gh', ['api', `repos/${CORE_REPO}/contents/${path}?ref=${ref}`]);
  if (!result.ok) fail(`core-pin: gh api failed for ${path} at ${ref}: ${result.output}`);
  const payload = JSON.parse(result.output) as { content?: string };
  if (!payload.content) fail(`core-pin: GitHub returned no content for ${path} at ${ref}`);
  return Buffer.from(payload.content, 'base64');
}

function findFile(root: string, name: string): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(join(root, entry.name), name);
      if (found) return found;
    }
  }
  return undefined;
}

interface CliOptions {
  version?: string;
  stage?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--version' || arg === '--stage') {
      if (value === undefined)
        fail(
          `core-pin: ${arg} needs a value\nusage: bun run scripts/core-pin.ts [--version <vX.Y.Z|X.Y.Z|latest>] [--stage <dir>]`,
        );
      options[arg === '--version' ? 'version' : 'stage'] = value;
      index++;
    } else if (arg.startsWith('--')) {
      fail(
        `core-pin: unknown flag ${arg}\nusage: bun run scripts/core-pin.ts [--version <vX.Y.Z|X.Y.Z|latest>] [--stage <dir>]`,
      );
    } else if (options.version === undefined) {
      options.version = arg;
    } else {
      fail(`core-pin: unexpected extra argument ${arg}`);
    }
  }
  return options;
}

function resolveTag(requested: string | undefined): string {
  if (requested !== undefined && requested !== 'latest') return tagFor(requested);
  const latest = run('gh', [
    'release',
    'view',
    '-R',
    CORE_REPO,
    '--json',
    'tagName',
    '--jq',
    '.tagName',
  ]);
  if (!latest.ok) fail(`core-pin: cannot resolve the latest release: ${latest.output}`);
  return latest.output;
}

export function requiredAssetsFor(tag: string): string[] {
  const archiveAsset = `par-mux-${tag}-aarch64-apple-darwin.tar.gz`;
  // The mux archive has no .sha256 sidecar upstream; its hash is the SHA256SUMS.txt entry.
  return [
    archiveAsset,
    `${archiveAsset}.minisig`,
    STREAMER_ASSET,
    `${STREAMER_ASSET}.sha256`,
    `${STREAMER_ASSET}.minisig`,
    `par-mux-${tag}-SHA256SUMS.txt`,
  ];
}

function requireAssets(tag: string, names: Set<string>): string[] {
  const required = requiredAssetsFor(tag);
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) fail(`core-pin: release ${tag} is missing assets: ${missing.join(', ')}`);
  return required;
}

function main(): void {
  const { version, stage } = parseArgs(process.argv.slice(2));
  const tag = resolveTag(version);
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`core-pin: ${tag} is not a vX.Y.Z release tag`);

  const view = run('gh', ['release', 'view', tag, '-R', CORE_REPO, '--json', 'tagName,assets']);
  if (!view.ok) fail(`core-pin: gh release view ${tag} failed: ${view.output}`);
  const release = JSON.parse(view.output) as { tagName: string; assets: { name: string }[] };
  if (release.tagName !== tag) fail(`core-pin: release tag is ${release.tagName}, expected ${tag}`);
  const required = requireAssets(tag, new Set(release.assets.map((asset) => asset.name)));

  const scratch = mkdtempSync(join(tmpdir(), 'core-pin-'));
  console.log(`core-pin: downloading ${tag} artifacts into ${scratch}`);
  const download = run('gh', [
    'release',
    'download',
    tag,
    '-R',
    CORE_REPO,
    '-D',
    scratch,
    ...required.flatMap((name) => ['-p', name]),
  ]);
  if (!download.ok) fail(`core-pin: gh release download ${tag} failed: ${download.output}`);
  for (const name of required) {
    if (!existsSync(join(scratch, name)))
      fail(`core-pin: ${name} did not download into ${scratch}`);
  }

  const archiveAssetName = `par-mux-${tag}-aarch64-apple-darwin.tar.gz`;
  const archivePath = join(scratch, archiveAssetName);
  const streamerPath = join(scratch, STREAMER_ASSET);
  const sumsText = readFileSync(join(scratch, `par-mux-${tag}-SHA256SUMS.txt`), 'utf8');
  const actualArchive = sha256File(archivePath);
  const expectedArchive = expectedFromChecksums(sumsText, archiveAssetName);
  if (actualArchive !== expectedArchive) {
    fail(
      `core-pin: mux archive sha256 mismatch: expected ${expectedArchive}, got ${actualArchive}`,
    );
  }
  console.log(`core-pin: mux archive sha256 OK (${actualArchive})`);
  const actualStreamer = sha256File(streamerPath);
  const expectedStreamer = expectedFromSidecar(
    readFileSync(join(scratch, `${STREAMER_ASSET}.sha256`), 'utf8'),
  );
  if (actualStreamer !== expectedStreamer) {
    fail(`core-pin: streamer sha256 mismatch: expected ${expectedStreamer}, got ${actualStreamer}`);
  }
  console.log(`core-pin: streamer sha256 OK (${actualStreamer})`);

  const minisignProbe = spawnSync('minisign', ['-v'], { encoding: 'utf8' });
  if (minisignProbe.error) {
    console.error('core-pin: install minisign (brew install minisign)');
    process.exit(2);
  }
  const publicKey = extractMinisignKey(
    fetchRepoFile('scripts/check-release-signatures.sh', tag).toString('utf8'),
  );
  const publicKeyPath = join(scratch, 'minisign.pub');
  writeFileSync(publicKeyPath, `${publicKey.comment}\n${publicKey.key}\n`);
  for (const artifact of [archiveAssetName, STREAMER_ASSET]) {
    const verified = run('minisign', [
      '-V',
      '-q',
      '-p',
      publicKeyPath,
      '-m',
      join(scratch, artifact),
      '-x',
      join(scratch, `${artifact}.minisig`),
    ]);
    if (!verified.ok)
      fail(`core-pin: minisign verification failed for ${artifact}: ${verified.output}`);
    console.log(`core-pin: minisign signature OK for ${artifact}`);
  }

  const extractDir = join(scratch, 'extracted');
  mkdirSync(extractDir);
  const untar = run('tar', ['-xzf', archivePath, '-C', extractDir]);
  if (!untar.ok) fail(`core-pin: tar extraction failed: ${untar.output}`);
  const muxBinary = findFile(extractDir, 'par-mux');
  if (!muxBinary)
    fail(`core-pin: no par-mux binary found in the archive extracted into ${extractDir}`);
  for (const binary of [streamerPath, muxBinary]) {
    const signed = run('codesign', ['--verify', '--strict', binary]);
    if (!signed.ok) fail(`core-pin: codesign verification failed for ${binary}: ${signed.output}`);
    console.log(`core-pin: codesign OK for ${binary}`);
  }

  const bindingAtTag = fetchRepoFile(BINDING_PATH, tag);
  const bindingHash = createHash('sha256').update(bindingAtTag).digest('hex');
  const vendoredHash = sha256File(VENDORED_BINDING);
  if (bindingHash === vendoredHash) {
    console.log(`core-pin: binding SAME (byte-identical, binding unchanged) ${bindingHash}`);
  } else {
    console.log(
      `core-pin: binding DIFFERS (binding must be replaced) upstream ${bindingHash}, vendored ${vendoredHash}`,
    );
  }

  const ref = run('gh', ['api', `repos/${CORE_REPO}/git/refs/tags/${tag}`, '--jq', '.object.sha']);
  if (!ref.ok) fail(`core-pin: gh api for the tag ref failed: ${ref.output}`);
  const commit = ref.output;
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`core-pin: unexpected tag ref response: ${commit}`);

  if (stage !== undefined) {
    mkdirSync(stage, { recursive: true });
    copyFileSync(streamerPath, join(stage, 'streamer-candidate'));
    copyFileSync(muxBinary, join(stage, 'mux-core'));
    for (const name of ['streamer-candidate', 'mux-core']) {
      chmodSync(join(stage, name), 0o755);
    }
    console.log(
      `core-pin: staged ${join(stage, 'streamer-candidate')} and ${join(stage, 'mux-core')}`,
    );
  }
  rmSync(scratch, { recursive: true, force: true });

  const current = JSON.parse(readFileSync('core-release.json', 'utf8')) as { version?: string };
  if (!current.version) fail('core-pin: core-release.json has no version');
  const prevVersion = versionFor(current.version);
  const docs: Record<string, string> = {};
  for (const file of PIN_SCAN_FILES) {
    if (!existsSync(file)) {
      console.error(`core-pin: skipping missing pin-scan file ${file}`);
      continue;
    }
    docs[file] = readFileSync(file, 'utf8');
  }
  console.log(`\ncore-pin: lines still naming core ${prevVersion}:`);
  const updates = scanPinFiles(docs, prevVersion);
  if (updates.length === 0) console.log('  (none)');
  for (const update of updates) console.log(`  ${update.file}: ${update.text.trim()}`);
  const nextJson = buildCoreReleaseJson({
    version: versionFor(tag),
    commit,
    streamer: { asset: STREAMER_ASSET, sha256: actualStreamer },
    muxArchive: { asset: archiveAssetName, sha256: actualArchive },
    binding: { sha256: bindingHash },
  });
  console.log(`\ncore-pin: new core-release.json:\n${nextJson}`);
  console.log('core-pin: checklist');
  console.log(
    '  1. Replace core-release.json with the content above and refresh the scanned files',
  );
  console.log(
    '  2. When the binding DIFFERS, replace src/terminal/vendor/terminal_pb.ts with the upstream file, then run make checkall',
  );
  console.log(
    '  3. Qualify with docs/TESTING.md "Private real-streamer checks" before serving the build',
  );
  console.log('  4. Push, LAN streamer rotation and daemon restart stay owner-gated');
}

if (import.meta.main) {
  void main();
}
