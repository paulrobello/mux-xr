import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, fchownSync, openSync } from 'node:fs';
import { chmod, chown, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentPlistPath,
  buildLaunchAgentPlist,
  buildLaunchDaemonPlist,
  DEFAULT_REPOSITORY,
  DEFAULT_USER,
  DICTATION_LABEL,
  DICTATION_PLIST_PATH,
  depthModelPath,
  isOwnedPlist,
  validateRepository,
  validateUser,
} from '../src/server/dictation-launchd';

type InstallerOptions = {
  install: boolean;
  uninstall: boolean;
  /** Per-user LaunchAgent in gui/<uid>, required for host clipboard sync. */
  agent: boolean;
  print: boolean;
  migrateRunningListener: boolean;
  repository: string;
  user: string;
  repoStatus: boolean;
  pictureProxy: boolean;
  pictureDepth: boolean;
  boardFeeds: boolean;
  serviceHealth: boolean;
  meshInbox: boolean;
  toastLan: boolean;
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
  let uninstall = false;
  let print = false;
  let repository = DEFAULT_REPOSITORY;
  let user = DEFAULT_USER;
  let migrateRunningListener = false;
  let agent = false;
  let repoStatus = false;
  let pictureProxy = false;
  let pictureDepth = false;
  let boardFeeds = false;
  let serviceHealth = false;
  let meshInbox = false;
  let toastLan = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--install') install = true;
    else if (argument === '--uninstall') uninstall = true;
    else if (argument === '--print') print = true;
    else if (argument === '--migrate-running-listener') migrateRunningListener = true;
    else if (argument === '--agent') agent = true;
    else if (argument === '--repo-status') repoStatus = true;
    else if (argument === '--picture-proxy') pictureProxy = true;
    else if (argument === '--picture-depth') pictureDepth = true;
    else if (argument === '--board-feeds') boardFeeds = true;
    else if (argument === '--service-health') serviceHealth = true;
    else if (argument === '--mesh-inbox') meshInbox = true;
    else if (argument === '--toast-lan') toastLan = true;
    else if (argument === '--repo') repository = argv[++index] ?? '';
    else if (argument === '--user') user = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (uninstall && !agent) throw new Error('--uninstall is only supported with --agent.');
  if ([install, print, uninstall].filter(Boolean).length > 1)
    throw new Error('Choose only one of --print, --install or --uninstall.');
  if (!install && !print && !uninstall) print = true;
  if (repoStatus && !agent) throw new Error('--repo-status is only supported with --agent.');
  if (pictureProxy && !agent) throw new Error('--picture-proxy is only supported with --agent.');
  if (pictureDepth && !agent) throw new Error('--picture-depth is only supported with --agent.');
  if (boardFeeds && !agent) throw new Error('--board-feeds is only supported with --agent.');
  if (serviceHealth && !agent) throw new Error('--service-health is only supported with --agent.');
  if (meshInbox && !agent) throw new Error('--mesh-inbox is only supported with --agent.');
  if (toastLan && !agent) throw new Error('--toast-lan is only supported with --agent.');
  if (agent && migrateRunningListener)
    throw new Error('--agent installs never migrate a running listener.');
  return {
    install,
    uninstall,
    agent,
    print,
    migrateRunningListener,
    repository: validateRepository(repository),
    user: validateUser(user),
    repoStatus,
    pictureProxy,
    pictureDepth,
    boardFeeds,
    serviceHealth,
    meshInbox,
    toastLan,
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

const preflight = (repository: string, user: string, pictureDepth = false): void => {
  const uid = Number(execFileSync('/usr/bin/id', ['-u', user], { encoding: 'utf8' }).trim());
  if (!Number.isInteger(uid) || uid <= 0)
    throw new Error(`User ${user} must exist with a non-root uid.`);
  for (const path of [
    '/opt/homebrew/bin/bun',
    `${repository}/scripts/dictation-server.ts`,
    `${repository}/.local/models/ggml-base.en.bin`,
    `${repository}/.local/https/_cert.pem`,
    // Only an install that turns depth on needs the model, so existing installs keep working.
    ...(pictureDepth ? [depthModelPath(repository)] : []),
  ])
    accessSync(path, constants.R_OK);
};

/**
 * The LaunchDaemon and the per-user LaunchAgent share a label and port 4242. A daemon install that
 * SIGTERMs the agent's listener would lose to KeepAlive restarting it, so refuse instead.
 */
export const assertNoAgentLoaded = (
  user: string,
  uid: number,
  isLoaded: (target: string) => boolean,
): void => {
  if (isLoaded(`gui/${uid}/${DICTATION_LABEL}`))
    throw new Error(
      `The per-user LaunchAgent gui/${uid}/${DICTATION_LABEL} is loaded. Run make uninstall-whisper-agent as ${user} first, then retry.`,
    );
};

const launchdTargetLoaded = (target: string): boolean =>
  spawnSync('/bin/launchctl', ['print', target]).status === 0;

const install = async (plist: string, options: InstallerOptions): Promise<void> => {
  if (process.getuid?.() !== 0)
    throw new Error('--install requires root. Use --print as a non-root user.');
  preflight(options.repository, options.user);
  assertNoAgentLoaded(
    options.user,
    Number(execFileSync('/usr/bin/id', ['-u', options.user], { encoding: 'utf8' }).trim()),
    launchdTargetLoaded,
  );
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

export type AgentInstallDeps = {
  uid: number;
  path: string;
  launchctl: (args: string[], allowFailure?: boolean) => string;
  daemonLoaded: () => boolean;
  agentLoaded: () => boolean;
  listenerPid: () => number | undefined;
  listenerUid: (pid: number) => number;
  healthy: () => boolean;
  readFile: (path: string) => Promise<string | undefined>;
  writeFile: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  lint: (path: string) => void;
  waitFor: (predicate: () => boolean, timeoutMs: number, message: string) => Promise<void>;
  pid: number;
};

const PORT_FREE_TIMEOUT_MS = 15_000;

const ownedAgentPlist = (contents: string): boolean =>
  contents.includes(`<string>${DICTATION_LABEL}</string>`);

/**
 * Installs the per-user LaunchAgent. Refuses while the system LaunchDaemon is loaded. A previous
 * agent is booted out and port 4242 must free (bounded) before the new one starts, and a failure
 * restores and re-bootstraps the previous plist.
 */
export const performAgentInstall = async (plist: string, deps: AgentInstallDeps): Promise<void> => {
  const target = `gui/${deps.uid}/${DICTATION_LABEL}`;
  if (deps.daemonLoaded())
    throw new Error(
      `The system LaunchDaemon is still loaded. First run: sudo launchctl bootout system/${DICTATION_LABEL} && sudo rm ${DICTATION_PLIST_PATH}`,
    );
  const existing = await deps.readFile(deps.path);
  if (existing !== undefined && !ownedAgentPlist(existing))
    throw new Error(`Refusing to replace foreign ${deps.path}.`);
  const previousLoaded = deps.agentLoaded();
  const temporary = `${deps.path}.tmp-${deps.pid}`;
  let replaced = false;
  try {
    if (previousLoaded) {
      deps.launchctl(['bootout', target], true);
      await deps.waitFor(
        () => deps.listenerPid() === undefined && !deps.agentLoaded(),
        PORT_FREE_TIMEOUT_MS,
        'Port 4242 did not free after stopping the previous LaunchAgent.',
      );
    } else if (deps.listenerPid() !== undefined)
      throw new Error('Port 4242 is occupied by another listener. Stop it first.');
    await deps.writeFile(temporary, plist);
    deps.lint(temporary);
    await deps.rename(temporary, deps.path);
    replaced = true;
    deps.launchctl(['bootstrap', `gui/${deps.uid}`, deps.path]);
    await deps.waitFor(
      () => {
        const pid = deps.listenerPid();
        return pid !== undefined && deps.listenerUid(pid) === deps.uid && deps.healthy();
      },
      60_000,
      'LaunchAgent did not own port 4242 and pass HTTPS health checks.',
    );
  } catch (error) {
    await deps.unlink(temporary).catch(() => undefined);
    if (replaced) deps.launchctl(['bootout', target], true);
    if (replaced && existing !== undefined) await deps.writeFile(deps.path, existing);
    else if (replaced) await deps.unlink(deps.path).catch(() => undefined);
    if (previousLoaded && existing !== undefined) {
      try {
        if (replaced)
          await deps.waitFor(
            () => deps.listenerPid() === undefined && !deps.agentLoaded(),
            PORT_FREE_TIMEOUT_MS,
            'Port 4242 did not free during rollback.',
          );
        deps.launchctl(['bootstrap', `gui/${deps.uid}`, deps.path]);
      } catch (rollbackError) {
        throw new Error(
          `LaunchAgent install failed and restoring the previous agent failed: ${String(rollbackError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
};

/** Boots out the per-user LaunchAgent, waits for port 4242 to free, and removes its plist. */
export const performAgentUninstall = async (deps: AgentInstallDeps): Promise<void> => {
  const existing = await deps.readFile(deps.path);
  if (existing !== undefined && !ownedAgentPlist(existing))
    throw new Error(`Refusing to remove foreign ${deps.path}.`);
  if (deps.agentLoaded()) {
    deps.launchctl(['bootout', `gui/${deps.uid}/${DICTATION_LABEL}`], true);
    await deps.waitFor(
      () => deps.listenerPid() === undefined,
      PORT_FREE_TIMEOUT_MS,
      'Port 4242 did not free after stopping the LaunchAgent.',
    );
  }
  if (existing !== undefined) await deps.unlink(deps.path);
};

const agentDeps = (options: InstallerOptions): AgentInstallDeps => {
  const uid = process.getuid?.();
  if (uid === undefined || uid === 0)
    throw new Error('--agent install and uninstall run as the logged-in user, not root.');
  if (
    Number(execFileSync('/usr/bin/id', ['-u', options.user], { encoding: 'utf8' }).trim()) !== uid
  )
    throw new Error(`--agent install and uninstall must run as ${options.user}.`);
  return {
    uid,
    path: agentPlistPath(options.user),
    launchctl,
    daemonLoaded: () => launchdTargetLoaded(`system/${DICTATION_LABEL}`),
    agentLoaded: () => launchdTargetLoaded(`gui/${uid}/${DICTATION_LABEL}`),
    listenerPid,
    listenerUid: (pid) => listenerMetadata(pid).uid,
    healthy: healthReady,
    readFile: async (path) => {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    writeFile: (path, contents) => writeFile(path, contents, { mode: 0o644 }),
    rename,
    unlink,
    lint: (path) => {
      execFileSync('/usr/bin/plutil', ['-lint', path], { stdio: 'pipe' });
    },
    waitFor,
    pid: process.pid,
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseInstallerArgs(process.argv.slice(2));
  const plist = options.agent ? buildLaunchAgentPlist(options) : buildLaunchDaemonPlist(options);
  if (options.print) process.stdout.write(plist);
  else if (options.agent && options.uninstall) await performAgentUninstall(agentDeps(options));
  else if (options.agent) {
    preflight(options.repository, options.user, options.pictureDepth);
    await performAgentInstall(plist, agentDeps(options));
  } else await install(plist, options);
}
