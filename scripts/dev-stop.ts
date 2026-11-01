import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const root = realpathSync(process.cwd());
function listeners(): number[] {
  try {
    return execFileSync('lsof', ['-nP', '-tiTCP:4240', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

const pids = listeners();
for (const pid of pids) {
  const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  if (!cwd || realpathSync(cwd) !== root)
    throw new Error(`Port 4240 belongs to process ${pid} outside this checkout`);
}
for (const pid of pids) process.kill(pid, 'SIGTERM');
const deadline = Date.now() + 2500;
while (listeners().length && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (Date.now() > deadline - 500) for (const pid of listeners()) process.kill(pid, 'SIGKILL');
}
if (listeners().length) throw new Error('Port 4240 did not become free');
console.log(
  pids.length ? 'Mux XR stopped; port 4240 is free.' : 'Mux XR is not running on port 4240.',
);
