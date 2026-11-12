import { resolve } from 'node:path';

export const DICTATION_LABEL = 'org.mux-xr.whisper';
export const DICTATION_PLIST_PATH = '/Library/LaunchDaemons/org.mux-xr.whisper.plist';
export const DEFAULT_REPOSITORY = '/Users/localuser/Repos/mux-xr';
export const DEFAULT_USER = 'localuser';
export const DICTATION_PORT = 4242;

export type DictationLaunchdOptions = {
  repository?: string;
  user?: string;
  /** Opts the agent into `/repo-status`, which runs git and gh; off unless asked for. */
  repoStatus?: boolean;
  /** Opts the agent into `/picture-fetch`, which fetches URLs for a paired client; off unless asked for. */
  pictureProxy?: boolean;
  /** Opts the agent into `/picture-depth`, which decodes images a paired client uploads; off unless asked for. */
  pictureDepth?: boolean;
};

const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

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

const serverArguments = (repository: string): string[] => {
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
    '--origin',
    'https://192.0.2.10:4240',
    '--origin',
    'https://localhost:4240',
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

export const agentPlistPath = (user: string): string =>
  `/Users/${validateUser(user)}/Library/LaunchAgents/${DICTATION_LABEL}.plist`;

export const buildLaunchDaemonPlist = (options: DictationLaunchdOptions = {}): string => {
  const repository = validateRepository(options.repository ?? DEFAULT_REPOSITORY);
  const user = validateUser(options.user ?? DEFAULT_USER);
  const array = plistArray(serverArguments(repository));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DICTATION_LABEL}</string>
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
  const repository = validateRepository(options.repository ?? DEFAULT_REPOSITORY);
  const array = plistArray([
    ...serverArguments(repository),
    '--clipboard-secret-file',
    clipboardSecretPath(repository),
    ...(options.repoStatus ? ['--repo-status', 'on'] : []),
    ...(options.pictureProxy ? ['--picture-proxy', 'on'] : []),
    ...(options.pictureDepth
      ? ['--picture-depth', 'on', '--depth-model', depthModelPath(repository)]
      : []),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DICTATION_LABEL}</string>
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

export const isOwnedPlist = (contents: string, expected: string): boolean => {
  const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1];
  return label === DICTATION_LABEL && contents === expected;
};
