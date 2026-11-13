import { JOIN_CODE_PATTERN, PLAYER_ID_PATTERN, playerName } from './identity.ts';
import { isRecord } from './shape.ts';

/** The most players a campaign's `players` frame lists: its whole roster, whoever is connected. */
export const MAX_CAMPAIGN_PLAYERS = 64;

/** The most earlier ids one seat names (`CampaignSeat.was`). */
export const MAX_SEAT_ALIASES = 16;

/** A player of the GM's campaign: the relay's id for them, their name and their own six-digit code. */
export interface CampaignSeat {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  /**
   * Ids the player had before the GM's players were merged into one list: a key the relay gave
   * under one of them takes this seat (`Table.attachPlayer`). Absent where there are none; a relay
   * from before it ignores it.
   */
  readonly was?: readonly string[];
}

/** The earlier ids of a seat: undefined where it names none, null for anything but a list of up to `MAX_SEAT_ALIASES` player ids. */
function readAliases(value: unknown): readonly string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SEAT_ALIASES) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !PLAYER_ID_PATTERN.test(id)) return null;
    ids.push(id);
  }
  return ids.length === 0 ? undefined : ids;
}

/** The roster of a `players` frame: up to `MAX_CAMPAIGN_PLAYERS` seats, none sharing an id or a code; null for anything else. */
export function parseSeats(value: unknown): CampaignSeat[] | null {
  if (!Array.isArray(value) || value.length > MAX_CAMPAIGN_PLAYERS) return null;
  const seats: CampaignSeat[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !PLAYER_ID_PATTERN.test(entry.id) || typeof entry.code !== 'string' || !JOIN_CODE_PATTERN.test(entry.code)) return null;
    const name = playerName(entry.name);
    const was = readAliases(entry.was);
    if (name === null || was === null || seats.some((seat) => seat.id === entry.id || seat.code === entry.code)) return null;
    seats.push(was === undefined ? { id: entry.id, name, code: entry.code } : { id: entry.id, name, code: entry.code, was });
  }
  return seats;
}

/** To a campaign's player: their own code, and whether it was made just now (the page tells them to keep it). */
export interface YourCodeMessage {
  readonly t: 'your-code';
  readonly code: string;
  readonly first: boolean;
}

/** A `your-code` message read from a GM's body, or null for anything else. */
export function parseYourCode(body: unknown): YourCodeMessage | null {
  if (!isRecord(body) || body.t !== 'your-code') return null;
  if (typeof body.code !== 'string' || !JOIN_CODE_PATTERN.test(body.code) || typeof body.first !== 'boolean') return null;
  return { t: 'your-code', code: body.code, first: body.first };
}
