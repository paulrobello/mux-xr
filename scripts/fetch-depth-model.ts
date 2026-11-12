import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Downloads the Depth Anything V2 Small ONNX model (Apache-2.0) for `/picture-depth`, pinned to one
 * Hugging Face revision and verified by SHA-256. Base and Large are non-commercial, so stay on Small.
 */
const REPOSITORY = 'onnx-community/depth-anything-v2-small';
const REVISION = '4472b7362082ad9968fee890ca0f1e5aca36b93d';
const FILE = 'onnx/model.onnx';
const SHA256 = 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c';
const target = resolve(process.argv[2] ?? '.local/models/depth-anything-v2-small.onnx');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

if (existsSync(target) && sha256(readFileSync(target)) === SHA256) {
  console.log(`Depth model already present and verified: ${target}`);
  process.exit(0);
}
const url = `https://huggingface.co/${REPOSITORY}/resolve/${REVISION}/${FILE}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const actual = sha256(bytes);
if (actual !== SHA256) throw new Error(`SHA-256 mismatch: expected ${SHA256}, got ${actual}`);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(`${target}.partial`, bytes);
renameSync(`${target}.partial`, target);
writeFileSync(
  `${target}.provenance.json`,
  `${JSON.stringify(
    {
      repository: REPOSITORY,
      revision: REVISION,
      file: FILE,
      sha256: SHA256,
      license: 'Apache-2.0',
      url,
    },
    null,
    2,
  )}\n`,
);
console.log(`Depth model installed: ${target} (${bytes.length} bytes, SHA-256 verified)`);
