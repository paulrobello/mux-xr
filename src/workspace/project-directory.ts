/** Signed directory hint for the host's canonical checkout when the shell supplies no cwd. */
const ROSTER_DIRECTORY = /^~\/Repos\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

export function rosterProjectDirectory(project: string | undefined): string | null {
  const hint = `~/Repos/${project ?? ''}`;
  return rosterDirectoryProject(hint) ? hint : null;
}

export function rosterDirectoryProject(directory: string): string | undefined {
  const match = ROSTER_DIRECTORY.exec(directory);
  return match?.[0] === directory ? match[1] : undefined;
}
