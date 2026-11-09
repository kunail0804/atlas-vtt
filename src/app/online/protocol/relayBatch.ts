import { isRecord } from './shape.ts';

/**
 * How the relay sends a GM's message to a player whose page acks. None: at once, in order with the
 * other messages. `paced`: in that same order, but only as fast as the player's link takes it (a
 * part of a large message). `bulk`: as fast as the link takes it, after everything else (an asset
 * chunk, which nothing depends on the order of). `live`: at once, before anything waiting (where
 * a dragged token is now, which only its latest value matters for).
 */
export type SendLane = 'paced' | 'bulk' | 'live';

const SEND_LANES: readonly string[] = ['paced', 'bulk', 'live'] satisfies readonly SendLane[];
export const isSendLane = (value: unknown): value is SendLane => typeof value === 'string' && SEND_LANES.includes(value);

/** The most game messages one `sends` frame of the GM carries. */
export const MAX_BATCH_SENDS = 64;

/** One game message of a GM's `sends` frame: to one player, or to all (`ALL_PLAYERS`). */
export interface BatchedSend {
  readonly to: string;
  readonly body: unknown;
  /** How the relay paces it to a player whose page acks (`SendLane`), as a `send` names it. */
  readonly lane?: SendLane;
}

/** A GM's `sends` frame: one to `MAX_BATCH_SENDS` messages, each with whom it goes to; null for anything else. Bodies are left unread. */
export function parseSends(value: unknown): BatchedSend[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_SENDS) return null;
  const sends: BatchedSend[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.to !== 'string' || !('body' in entry) || (entry.lane !== undefined && !isSendLane(entry.lane))) return null;
    sends.push({ to: entry.to, body: entry.body, ...(isSendLane(entry.lane) && { lane: entry.lane }) });
  }
  return sends;
}
