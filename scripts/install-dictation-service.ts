import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, fchownSync, openSync } from 'node:fs';
import { chmod, chown, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLaunchDaemonPlist,
  DEFAULT_REPOSITORY,
  DEFAULT_USER,
  DICTATION_LABEL,
  DICTATION_PLIST_PATH,
  isOwnedPlist,
  validateRepository,
  validateUser,
} from '../src/server/dictation-launchd';

type InstallerOptions = {
  install: boolean;
  print: boolean;
  migrateRunningListener: boolean;
  repository: string;
  user: string;
};
export type ListenerMetadata = {
  uid: number;
  gid: number;
  executable: string;
  cwd: string;
  args: string[];
};

export const parseInstallerArgs = (argv: string[]): InstallerOptions => {
  let install = false;
  let print = false;
  let repository = DEFAULT_REPOSITORY;
  let user = DEFAULT_USER;
  let migrateRunningListener = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--install') install = true;
    else if (argument === '--print') print = true;
    else if (argument === '--migrate-running-listener') migrateRunningListener = true;
    else if (argument === '--repo') repository = argv[++index] ?? '';
    else if (argument === '--user') user = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!install && !print) print = true;
  if (install && print) throw new Error('Choose only one of --print or --install.');
  return {
    install,
    print,
    migrateRunningListener,
    repository: validateRepository(repository),
    user: validateUser(user),
  };
};

export const isSafeMigratableListener = (
  metadata: ListenerMetadata,
  repository: string,
  userUid: number,
): boolean => {
  const script = `${repository}/scripts/dictation-server.ts`;
  return (
    metadata.uid === userUid &&
    basename(metadata.executable) === 'bun' &&
    metadata.cwd === repository &&
    metadata.args[0] === 'run' &&
    (metadata.args[1] === script || metadata.args[1] === 'scripts/dictation-server.ts')
  );
};

const launchctl = (args: string[], allowFailure = false): string => {
  try {
    return execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
};

const ownedJobPid = (): number | undefined =>
  Number(/\bpid\s*=\s*(\d+)/.exec(launchctl(['print', `system/${DICTATION_LABEL}`], true))?.[1]) ||
  undefined;

export const parseListenerPid = (output: string): number | undefined => {
  const fields = output.trim().split(/\s+/).filter(Boolean);
  const pids = fields.map(Number);
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error('Invalid PID-only lsof output.');
  const unique = [...new Set(pids)];
  if (unique.length > 1) throw new Error('Port 4242 has multiple listening owners.');
  return unique[0];
};

const listenerPid = (): number | undefined => {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-t', '-iTCP:4242', '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`lsof failed with status ${result.status}.`);
  return parseListenerPid(result.stdout);
};

const listenerMetadata = (pid: number): ListenerMetadata => {
  const ps = execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'uid=,gid=,args='], {
    encoding: 'utf8',
  }).trim();
  const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(ps);
  const executable = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).match(/\nn(.+)/)?.[1];
  const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  }).match(/\nn(.+)/)?.[1];
  if (!match || !cwd || !executable) throw new Error(`Unable to inspect listener PID ${pid}.`);
  return {
    uid: Number(match[1]),
    gid: Number(match[2]),
    executable,
    cwd,
    args: match[3].trim().split(/\s+/).slice(1),
  };
};

export const inspectRunningListener = ():
  | { pid: number; metadata: ListenerMetadata }
  | undefined => {
  const pid = listenerPid();
  return pid === undefined ? undefined : { pid, metadata: listenerMetadata(pid) };
};

const healthReady = (): boolean => {
  const result = spawnSync(
    '/usr/bin/curl',
    ['-ksf', '--max-time', '2', 'https://127.0.0.1:4242/health'],
    { encoding: 'utf8', timeout: 3_000 },
  );
  if (result.status !== 0) return false;
  try {
    return JSON.parse(result.stdout).ready === true;
  } catch {
    return false;
  }
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
};

const migrateListener = async (
  repository: string,
  user: string,
  pid: number,
): Promise<ListenerMetadata> => {
  const uid = Number(execFileSync('/usr/bin/id', ['-u', user], { encoding: 'utf8' }).trim());
  if (!isSafeMigratableListener(listenerMetadata(pid), repository, uid))
    throw new Error('Refusing to terminate an unrecognized port 4242 listener.');
  await waitFor(
    () =>
      spawnSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-iTCP:4242', '-sTCP:ESTABLISHED'])
        .status === 1,
    90_000,
    'Timed out waiting for dictation clients to finish.',
  );
  const metadata = listenerMetadata(pid);
  if (listenerPid() !== pid || !isSafeMigratableListener(metadata, repository, uid))
    throw new Error('Port 4242 owner changed during migration.');
  process.kill(pid, 'SIGTERM');
  await waitFor(
    () => listenerPid() === undefined,
    10_000,
    'Timed out waiting for port 4242 to become free.',
  );
  return metadata;
};

const restoreListener = async (metadata: ListenerMetadata, user: string): Promise<void> => {
  const log = openSync(`${metadata.cwd}/.local/whisper-migration-recovery.log`, 'a', 0o600);
  try {
    fchownSync(log, metadata.uid, metadata.gid);
    const child = spawn(metadata.executable, metadata.args, {
      cwd: metadata.cwd,
      uid: metadata.uid,
      gid: metadata.gid,
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: `/Users/${user}`,
        USER: user,
        LOGNAME: user,
        TMPDIR: '/tmp',
      },
    });
    await new Promise<void>((done, reject) => {
      child.once('spawn', done);
      child.once('error', reject);
    });
    child.unref();
    await waitFor(
      () => listenerPid() === child.pid && healthReady(),
      10_000,
      'Original listener recovery did not become healthy.',
    );
  } finally {
    closeSync(log);
  }
};

const preflight = (repository: string, user: string): void => {
  const uid = Number(execFileSync('/usr/bin/id', ['-u', user], { encoding: 'utf8' }).trim());
  if (!Number.isInteger(uid) || uid <= 0)
    throw new Error(`User ${user} must exist with a non-root uid.`);
  for (const path of [
    '/opt/homebrew/bin/bun',
    `${repository}/scripts/dictation-server.ts`,
    `${repository}/.local/models/ggml-base.en.bin`,
    `${repository}/.local/https/_cert.pem`,
  ])
    accessSync(path, constants.R_OK);
};

const install = async (plist: string, options: InstallerOptions): Promise<void> => {
  if (process.getuid?.() !== 0)
    throw new Error('--install requires root. Use --print as a non-root user.');
  preflight(options.repository, options.user);
  let existing: string | undefined;
  try {
    existing = await readFile(DICTATION_PLIST_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing !== undefined && !isOwnedPlist(existing, plist))
    throw new Error(`Refusing to replace foreign or changed ${DICTATION_PLIST_PATH}.`);
  const initialPid = listenerPid();
  const existingLaunchdPid = ownedJobPid();
  if (
    initialPid !== undefined &&
    initialPid !== existingLaunchdPid &&
    !options.migrateRunningListener
  )
    throw new Error(
      'Port 4242 is occupied. Pass --migrate-running-listener to replace a recognized Bun listener.',
    );
  const temporary = `${DICTATION_PLIST_PATH}.tmp-${process.pid}`;
  let migrated: ListenerMetadata | undefined;
  let installed = false;
  try {
    await writeFile(temporary, plist, { mode: 0o644 });
    await chmod(temporary, 0o644);
    await chown(temporary, 0, 0);
    execFileSync('/usr/bin/plutil', ['-lint', temporary], { stdio: 'pipe' });
    if (initialPid !== undefined && initialPid !== existingLaunchdPid) {
      migrated = await migrateListener(options.repository, options.user, initialPid);
    }
    await rename(temporary, DICTATION_PLIST_PATH);
    installed = true;
    launchctl(['bootout', `system/${DICTATION_LABEL}`], true);
    launchctl(['bootstrap', 'system', DICTATION_PLIST_PATH]);
    await waitFor(
      () => {
        const pid = listenerPid();
        return (
          pid !== undefined &&
          pid === ownedJobPid() &&
          listenerMetadata(pid).uid ===
            Number(
              execFileSync('/usr/bin/id', ['-u', options.user], { encoding: 'utf8' }).trim(),
            ) &&
          healthReady()
        );
      },
      60_000,
      'LaunchDaemon did not own port 4242 and pass HTTPS health checks.',
    );
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    let rollbackError: unknown;
    try {
      let previousJobRestored = false;
      if (installed) {
        launchctl(['bootout', `system/${DICTATION_LABEL}`], true);
        if (existing !== undefined) {
          await writeFile(DICTATION_PLIST_PATH, existing, { mode: 0o644 });
          await chmod(DICTATION_PLIST_PATH, 0o644);
          await chown(DICTATION_PLIST_PATH, 0, 0);
          launchctl(['bootstrap', 'system', DICTATION_PLIST_PATH]);
          try {
            await waitFor(
              () => {
                const pid = listenerPid();
                return pid !== undefined && pid === ownedJobPid() && healthReady();
              },
              20_000,
              'Previous LaunchDaemon did not recover.',
            );
            previousJobRestored = true;
          } catch (restoreError) {
            launchctl(['bootout', `system/${DICTATION_LABEL}`], true);
            if (!migrated) throw restoreError;
          }
        } else await unlink(DICTATION_PLIST_PATH);
      }
      if (migrated && !previousJobRestored) await restoreListener(migrated, options.user);
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure;
    }
    if (rollbackError)
      throw new Error(`LaunchDaemon install failed and rollback failed: ${String(rollbackError)}`, {
        cause: error,
      });
    throw error;
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseInstallerArgs(process.argv.slice(2));
  const plist = buildLaunchDaemonPlist(options);
  if (options.print) process.stdout.write(plist);
  else await install(plist, options);
}
