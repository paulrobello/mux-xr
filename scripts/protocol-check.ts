import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// core-release.json pins the upstream generated binding (generatedProtocol.path) by SHA-256.
// The vendored copy must be byte-identical to it, so a hand edit or a partial core upgrade fails here.
const VENDORED_BINDING = 'src/terminal/vendor/terminal_pb.ts';

const release = JSON.parse(readFileSync('core-release.json', 'utf8')) as {
  generatedProtocol?: { path?: string; sha256?: string };
};
const pinned = release.generatedProtocol?.sha256;
if (!pinned) {
  console.error('protocol-check: core-release.json has no generatedProtocol.sha256');
  process.exit(1);
}

const actual = createHash('sha256').update(readFileSync(VENDORED_BINDING)).digest('hex');
if (actual !== pinned) {
  console.error(`protocol-check: ${VENDORED_BINDING} does not match core-release.json`);
  console.error(`  pinned (generatedProtocol.sha256): ${pinned}`);
  console.error(`  actual:                            ${actual}`);
  process.exit(1);
}
console.log(`protocol-check: ${VENDORED_BINDING} matches core-release.json (${actual})`);
