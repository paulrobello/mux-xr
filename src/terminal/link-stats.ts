/**
 * Cumulative counters for one pane's stream socket. Every field only grows (except `rttMs`), so a
 * reader takes deltas between two snapshots to get a rate or a count over a window.
 */
export interface TerminalLinkStats {
  /** Bytes of server messages received, across reconnects. */
  bytesReceived: number;
  /** `connected` handshakes after the first one. */
  reconnects: number;
  /**
   * Damage-less output chunks on a connection that was sending damage. The streamer sends one
   * after it dropped broadcast frames for a lagging client (or on a workspace retarget).
   */
  resyncs: number;
  /** Pings that got no pong within `LINK_PING_TIMEOUT_MS`. */
  missedPings: number;
  /** Round trip of the latest answered ping; null before the first pong on this connection. */
  rttMs: number | null;
}

/** A ping with no pong after this long counts as missed. */
export const LINK_PING_TIMEOUT_MS = 4000;

export interface LinkStatsRecorder {
  readonly stats: Readonly<TerminalLinkStats>;
  noteMessage(bytes: number): void;
  noteConnected(): void;
  noteOutput(hasDamage: boolean): void;
  /** Sends at most one ping in flight (Pong carries no id); returns whether one was sent. */
  ping(nowMs: number, send: () => boolean): boolean;
  notePong(nowMs: number): void;
  /** The socket closed: a ping in flight on it can no longer be answered. */
  noteClosed(): void;
}

export function createLinkStatsRecorder(): LinkStatsRecorder {
  const stats: TerminalLinkStats = {
    bytesReceived: 0,
    reconnects: 0,
    resyncs: 0,
    missedPings: 0,
    rttMs: null,
  };
  let connections = 0;
  let damageSeen = false;
  let pingSentAt: number | null = null;
  return {
    stats,
    noteMessage(bytes) {
      if (Number.isFinite(bytes) && bytes > 0) stats.bytesReceived += bytes;
    },
    noteConnected() {
      connections += 1;
      if (connections > 1) stats.reconnects += 1;
      damageSeen = false;
      pingSentAt = null;
      stats.rttMs = null;
    },
    noteOutput(hasDamage) {
      if (hasDamage) damageSeen = true;
      else if (damageSeen) stats.resyncs += 1;
    },
    ping(nowMs, send) {
      if (pingSentAt !== null) {
        if (nowMs - pingSentAt < LINK_PING_TIMEOUT_MS) return false;
        stats.missedPings += 1;
        pingSentAt = null;
      }
      if (!send()) return false;
      pingSentAt = nowMs;
      return true;
    },
    notePong(nowMs) {
      if (pingSentAt === null) return;
      stats.rttMs = Math.max(0, nowMs - pingSentAt);
      pingSentAt = null;
    },
    noteClosed() {
      pingSentAt = null;
    },
  };
}
