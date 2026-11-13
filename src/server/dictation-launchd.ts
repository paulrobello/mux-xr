import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';

export const DICTATION_LABEL = 'org.mux-xr.whisper';
export const daemonPlistPath = (label = DICTATION_LABEL): string =>
  `/Library/LaunchDaemons/${validateLabel(label)}.plist`;
const DEFAULT_ORIGINS = ['https://localhost:4240'];

export interface HostConfig {
  repository?: string;
  user?: string;
  origins?: string[];
  grafanaUrl?: string;
  launchdLabel?: string;
  handSource?: string;
}

export function readHostConfig(repository: string): HostConfig {
  let raw: string;
  try {
    raw = readFileSync(join(repository, '.local/host-config.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const value = JSON.parse(raw) as HostConfig | null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value.repository !== undefined && typeof value.repository !== 'string') ||
    (value.user !== undefined && typeof value.user !== 'string') ||
    (value.launchdLabel !== undefined && typeof value.launchdLabel !== 'string') ||
    (value.handSource !== undefined && typeof value.handSource !== 'string') ||
    (value.grafanaUrl !== undefined && typeof value.grafanaUrl !== 'string') ||
    (value.origins !== undefined &&
      (!Array.isArray(value.origins) ||
        value.origins.length === 0 ||
        value.origins.some((origin) => typeof origin !== 'string')))
  )
    throw new Error('Invalid .local/host-config.json.');
  return value;
}

export const defaultDictationUser = (): string => process.env.SUDO_USER || userInfo().username;
export const DICTATION_PORT = 4242;

export type DictationLaunchdOptions = {
  repository?: string;
  user?: string;
  origins?: readonly string[];
  label?: string;
  /** Opts the agent into `/repo-status`, which runs git and gh; off unless asked for. */
  repoStatus?: boolean;
  /** Opts the agent into `/picture-fetch`, which fetches URLs for a paired client; off unless asked for. */
  pictureProxy?: boolean;
  /** Opts the agent into `/picture-depth`, which decodes images a paired client uploads; off unless asked for. */
  pictureDepth?: boolean;
  /** Opts the agent into the kanban feeds, which run the kanban CLI's read commands; off unless asked for. */
  boardFeeds?: boolean;
  /** Opts the agent into `/service-health`, which queries par-obs with a service token; off unless asked for. */
  serviceHealth?: boolean;
  /** Opts the agent into `/mesh-inbox`, which runs `par-mesh history`; off unless asked for. */
  meshInbox?: boolean;
  /** Accepts `/toast` senders from other LAN hosts too; this Mac only unless asked for. */
  toastLan?: boolean;
};

const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export function validateLabel(label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/.test(label))
    throw new Error('Invalid launchd label.');
  return label;
}

export const validateUser = (user: string): string => {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(user)) throw new Error(`Invalid macOS user: ${user}`);
  if (user === 'root') throw new Error('LaunchDaemon user must be non-root.');
  return user;
};

export const validateRepository = (repository: string): string => {
  if (!repository.startsWith('/')) throw new Error('Repository path must be absolute.');
  const normalized = resolve(repository);
  if (normalized.includes('/.codex/worktrees/'))
    throw new Error('Repository path must point to the stable checkout, not a worktree.');
  return normalized;
};

const serverArguments = (repository: string, origins: readonly string[]): string[] => {
  if (
    origins.length === 0 ||
    origins.some((origin) => {
      const url = URL.parse(origin);
      return !url || url.origin !== origin || url.protocol !== 'https:';
    })
  )
    throw new Error('Dictation origins must be HTTPS origins without a path.');
  const script = `${repository}/scripts/dictation-server.ts`;
  const model = `${repository}/.local/models/ggml-base.en.bin`;
  const pem = `${repository}/.local/https/_cert.pem`;
  return [
    '/opt/homebrew/bin/bun',
    'run',
    script,
    '--host',
    '0.0.0.0',
    '--port',
    String(DICTATION_PORT),
    ...origins.flatMap((origin) => ['--origin', origin]),
    '--cert',
    pem,
    '--key',
    pem,
    '--model',
    model,
  ];
};

const plistArray = (args: string[]): string =>
  args.map((argument) => `    <string>${xml(argument)}</string>`).join('\n');

/** The pairing secret the user creates; the server never creates or defaults it. */
/** The pinned Depth Anything V2 Small model that `scripts/fetch-depth-model.ts` installs. */
export const depthModelPath = (repository: string): string =>
  `${repository}/.local/models/depth-anything-v2-small.onnx`;

export const clipboardSecretPath = (repository: string): string =>
  `${repository}/.local/clipboard-secret`;

/** The owner-created CF Access service token for par-obs Grafana; never created by an installer. */
export const parObsQueryEnvPath = (repository: string): string =>
  `${repository}/.local/par-obs-query.env`;

export const agentPlistPath = (user: string, label = DICTATION_LABEL): string =>
  `/Users/${validateUser(user)}/Library/LaunchAgents/${validateLabel(label)}.plist`;

export const buildLaunchDaemonPlist = (options: DictationLaunchdOptions = {}): string => {
  const repository = validateRepository(options.repository ?? process.cwd());
  const user = validateUser(options.user ?? defaultDictationUser());
  const array = plistArray(serverArguments(repository, options.origins ?? DEFAULT_ORIGINS));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${validateLabel(options.label ?? DICTATION_LABEL)}</string>
  <key>UserName</key>
  <string>${xml(user)}</string>
  <key>ProgramArguments</key>
  <array>
${array}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repository)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(`${repository}/.local/whisper-launchd.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(`${repository}/.local/whisper-launchd.log`)}</string>
</dict>
</plist>
`;
};

/**
 * The same server as a per-user LaunchAgent in the gui/<uid> domain. Only that Aqua session can reach
 * the user's pasteboard (com.apple.pboard), so clipboard sync needs this instead of the LaunchDaemon.
 */
export const buildLaunchAgentPlist = (options: DictationLaunchdOptions = {}): string => {
  const repository = validateRepository(options.repository ?? process.cwd());
  const array = plistArray([
    ...serverArguments(repository, options.origins ?? DEFAULT_ORIGINS),
    '--clipboard-secret-file',
    clipboardSecretPath(repository),
    ...(options.repoStatus ? ['--repo-status', 'on'] : []),
    ...(options.pictureProxy ? ['--picture-proxy', 'on'] : []),
    ...(options.pictureDepth
      ? ['--picture-depth', 'on', '--depth-model', depthModelPath(repository)]
      : []),
    ...(options.boardFeeds ? ['--board-feeds', 'on'] : []),
    ...(options.serviceHealth
      ? ['--service-health', 'on', '--service-health-env-file', parObsQueryEnvPath(repository)]
      : []),
    ...(options.meshInbox ? ['--mesh-inbox', 'on'] : []),
    ...(options.toastLan ? ['--toast-lan', 'on'] : []),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${validateLabel(options.label ?? DICTATION_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${array}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repository)}</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(`${repository}/.local/whisper-launchd.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(`${repository}/.local/whisper-launchd.log`)}</string>
</dict>
</plist>
`;
};

export const isOwnedPlist = (
  contents: string,
  expected: string,
  label = DICTATION_LABEL,
): boolean => {
  const actualLabel = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1];
  return actualLabel === label && contents === expected;
};
