import type { TerminalStatus } from '../contracts';

/** Escapes text for use inside an HTML text node or a double- or single-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

export function icon(name: 'close' | 'link' | 'xr' | 'send' | 'plus' | 'settings'): string {
  const paths: Record<string, string> = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10 6"/><path d="M14 11a5 5 0 0 0-7.1-.1L5.5 12.3a5 5 0 0 0 7.1 7.1L14 18"/>',
    xr: '<path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-4.6 1.3L14 14h-4l-1.4 1.8A2.5 2.5 0 0 1 4 14.5v-5Z"/><circle cx="8" cy="11" r="1"/><circle cx="16" cy="11" r="1"/>',
    send: '<path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings:
      '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19 13 1.2 1-.9 1.6-1.5-.4a7.8 7.8 0 0 1-1.5 1l-.2 1.5h-1.9l-.5-1.4a7.8 7.8 0 0 1-1.9 0l-.5 1.4h-1.9l-.2-1.5a7.8 7.8 0 0 1-1.5-1l-1.5.4-.9-1.6L6 13a7.8 7.8 0 0 1 0-2L4.8 10l.9-1.6 1.5.4a7.8 7.8 0 0 1 1.5-1l.2-1.5h1.9l.5 1.4a7.8 7.8 0 0 1 1.9 0l.5-1.4h1.9l.2 1.5a7.8 7.8 0 0 1 1.5 1l1.5-.4.9 1.6-1.2 1a7.8 7.8 0 0 1 0 2Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

export function connectionActionLabel(status: TerminalStatus | undefined): string {
  return status === undefined || status === 'connected' || status === 'connecting'
    ? 'Disconnect'
    : 'Reconnect';
}

export function connectionActionTitle(title: string, status: TerminalStatus | undefined): string {
  return status === undefined || status === 'connected' || status === 'connecting'
    ? `Disconnect ${title} view without stopping the terminal`
    : `Reconnect ${title} view to the running terminal`;
}
