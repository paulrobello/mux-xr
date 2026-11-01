export async function reloadAfterXR(
  exitXR: () => Promise<void>,
  location: Pick<Location, 'href' | 'replace'>,
): Promise<void> {
  await exitXR();
  const url = new URL(location.href);
  url.searchParams.set('_reload', String(Date.now()));
  location.replace(url.href);
}
