/**
 * The compendium pages the GM shares with the players of the table, as `atlas-vtt/players.json`
 * keeps them: by vault path of the note, then the id of a player of the table (`TablePlayers`), the
 * access each has. The players themselves are the table's; this file only says what is shared with
 * whom. Shares outlive tables and campaigns; only the GM, or the note's deletion, ends them.
 */

import { PLAYER_ID_PATTERN } from '../online/protocol/index';

export type ShareAccess = 'read' | 'write';

/** By vault path of the note, then player id. */
export type Shares = Readonly<Record<string, Readonly<Record<string, ShareAccess>>>>;

export interface PageShares {
  readonly shares: Shares;
}

/** A player of the table, as a note's shares name them. */
export interface NamedPlayer {
  readonly id: string;
  readonly name: string;
}

export const SHARES_FORMAT = 2;
export const NO_SHARES: PageShares = { shares: {} };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isAccess = (value: unknown): value is ShareAccess => value === 'read' || value === 'write';

/** The shares of a record: notes with a path, players of the table by their id, accesses Atlas knows. */
function readShares(value: unknown): Shares {
  const shares: Record<string, Record<string, ShareAccess>> = {};
  for (const [path, entry] of Object.entries(isRecord(value) ? value : {})) {
    if (path === '' || !isRecord(entry)) continue;
    const kept = Object.entries(entry).filter((pair): pair is [string, ShareAccess] => PLAYER_ID_PATTERN.test(pair[0]) && isAccess(pair[1]));
    if (kept.length > 0) shares[path] = Object.fromEntries(kept);
  }
  return shares;
}

/** The shares a file holds; what cannot be read is left out, and a file that cannot be read shares nothing. */
export function parseShares(text: string | null): PageShares {
  let raw: unknown = null;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  return isRecord(raw) ? { shares: readShares(raw.shares) } : NO_SHARES;
}

export function serializeShares(shares: PageShares): string {
  return `${JSON.stringify({ format: SHARES_FORMAT, shares: shares.shares }, null, 2)}\n`;
}

/** The shares with those of `path` set to `players`; a note shared with nobody leaves the list. */
function withShares(current: PageShares, path: string, players: Readonly<Record<string, ShareAccess>>): PageShares {
  const shares = { ...current.shares };
  if (Object.keys(players).length === 0) delete shares[path];
  else shares[path] = players;
  return { shares };
}

/**
 * Sets the shares of every note of `paths` for the players of `changes`: an access shares the
 * note with them (or changes theirs), null takes it back. Players left out keep what they had.
 */
export function setShares(current: PageShares, paths: readonly string[], changes: Readonly<Record<string, ShareAccess | null>>): PageShares {
  let next = current;
  for (const path of paths) {
    const shared: Record<string, ShareAccess> = { ...(next.shares[path] ?? {}) };
    for (const [id, access] of Object.entries(changes)) {
      if (!PLAYER_ID_PATTERN.test(id)) continue;
      if (access === null) delete shared[id];
      else shared[id] = access;
    }
    next = withShares(next, path, shared);
  }
  return next;
}

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** A note or a folder moved: its shares, and those of every note inside it, follow. */
export function movePath(current: PageShares, from: string, to: string): PageShares {
  if (!Object.keys(current.shares).some((path) => within(path, from))) return current;
  const shares: Record<string, Readonly<Record<string, ShareAccess>>> = {};
  for (const [path, shared] of Object.entries(current.shares)) shares[within(path, from) ? to + path.slice(from.length) : path] = shared;
  return { shares };
}

/** A note or a folder was deleted: its shares, and those of every note inside it, end. */
export function dropPath(current: PageShares, path: string): PageShares {
  if (!Object.keys(current.shares).some((shared) => within(shared, path))) return current;
  return { shares: Object.fromEntries(Object.entries(current.shares).filter(([shared]) => !within(shared, path))) };
}

/** The notes shared with a player of the table, by path, with the access each gives. */
export function sharesOf(current: PageShares, id: string): Array<{ path: string; access: ShareAccess }> {
  const shared: Array<{ path: string; access: ShareAccess }> = [];
  for (const [path, players] of Object.entries(current.shares)) {
    const access = players[id];
    if (access !== undefined) shared.push({ path, access });
  }
  return shared.sort((a, b) => a.path.localeCompare(b.path));
}

/** Who among `players` a note is shared with, and how: players no longer at the table are left out. */
export function sharedWith(current: PageShares, path: string, players: readonly NamedPlayer[]): Array<NamedPlayer & { access: ShareAccess }> {
  const shared = current.shares[path] ?? {};
  return players.flatMap((player) => {
    const access = shared[player.id];
    return access === undefined ? [] : [{ ...player, access }];
  });
}
