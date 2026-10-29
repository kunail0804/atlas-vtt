/**
 * The GM's players and the compendium pages shared with them, as `atlas-vtt/players.json` keeps
 * them. A player is one person, the same in every campaign and every table: Atlas knows them by the
 * devices they joined from (each browser keeps a key of its own; only its SHA-256 is kept here).
 * A share gives a player a note to read, or to read and change. Shares outlive tables and
 * campaigns; only removing the player, or the note, ends them.
 */

export type ShareAccess = 'read' | 'write';

export interface RosterPlayer {
  readonly name: string;
  /** The SHA-256 (hex) of each device key this player joined with. */
  readonly devices: readonly string[];
  readonly createdAt: number;
}

export interface Roster {
  /** By player id. */
  readonly players: Readonly<Record<string, RosterPlayer>>;
  /** By vault path of the note, then player id. */
  readonly shares: Readonly<Record<string, Readonly<Record<string, ShareAccess>>>>;
}

export const ROSTER_FORMAT = 1;
export const EMPTY_ROSTER: Roster = { players: {}, shares: {} };
/** The longest name a player keeps, as the table's own limit for a name. */
export const MAX_PLAYER_NAME = 40;
/** The devices one player keeps; joining from one more forgets the oldest. */
export const MAX_DEVICES = 20;

const PLAYER_ID = /^p[0-9a-f]{8,32}$/;
const DEVICE = /^[0-9a-f]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isAccess = (value: unknown): value is ShareAccess => value === 'read' || value === 'write';

/** A player's name as Atlas keeps it: trimmed, on one line, within `MAX_PLAYER_NAME`; null when empty. */
export function playerNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYER_NAME);
  return name === '' ? null : name;
}

/** The roster a file holds; what cannot be read is left out, and a file that cannot be read is an empty roster. */
export function parseRoster(text: string | null): Roster {
  let raw: unknown = null;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  if (!isRecord(raw)) return EMPTY_ROSTER;
  const players: Record<string, RosterPlayer> = {};
  for (const [id, entry] of Object.entries(isRecord(raw.players) ? raw.players : {})) {
    const name = isRecord(entry) ? playerNameOf(entry.name) : null;
    if (!PLAYER_ID.test(id) || name === null || !isRecord(entry)) continue;
    const devices = Array.isArray(entry.devices) ? entry.devices.filter((device): device is string => typeof device === 'string' && DEVICE.test(device)).slice(-MAX_DEVICES) : [];
    const createdAt = typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : 0;
    players[id] = { name, devices, createdAt };
  }
  const shares: Record<string, Record<string, ShareAccess>> = {};
  for (const [path, entry] of Object.entries(isRecord(raw.shares) ? raw.shares : {})) {
    if (path === '' || !isRecord(entry)) continue;
    const kept = Object.entries(entry).filter((pair): pair is [string, ShareAccess] => pair[0] in players && isAccess(pair[1]));
    if (kept.length > 0) shares[path] = Object.fromEntries(kept);
  }
  return { players, shares };
}

export function serializeRoster(roster: Roster): string {
  return `${JSON.stringify({ format: ROSTER_FORMAT, players: roster.players, shares: roster.shares }, null, 2)}\n`;
}

/** The roster with the shares of `path` set to `players`; a note shared with nobody leaves the list. */
function withShares(roster: Roster, path: string, players: Readonly<Record<string, ShareAccess>>): Roster {
  const shares = { ...roster.shares };
  if (Object.keys(players).length === 0) delete shares[path];
  else shares[path] = players;
  return { ...roster, shares };
}

/**
 * The player a device is: the one it joined as before; else a player the GM made who joined from no
 * device yet and has the name given (any case), who takes it; else a new player of that name.
 */
export function identifyDevice(roster: Roster, device: string, name: string, now: number, newId: () => string): { roster: Roster; id: string } {
  for (const [id, player] of Object.entries(roster.players)) if (player.devices.includes(device)) return { roster, id };
  const given = playerNameOf(name) ?? 'Player';
  const waiting = Object.entries(roster.players).find(([, player]) => player.devices.length === 0 && player.name.toLowerCase() === given.toLowerCase());
  if (waiting) {
    const [id, player] = waiting;
    return { roster: { ...roster, players: { ...roster.players, [id]: { ...player, devices: [device] } } }, id };
  }
  let id = newId();
  while (id in roster.players) id = newId();
  return { roster: { ...roster, players: { ...roster.players, [id]: { name: given, devices: [device], createdAt: now } } }, id };
}

/** A player the GM makes before they join: the first device to join under that name becomes theirs. */
export function addPlayer(roster: Roster, name: string, now: number, newId: () => string): { roster: Roster; id: string } {
  const given = playerNameOf(name);
  if (given === null) throw new Error('A player needs a name.');
  let id = newId();
  while (id in roster.players) id = newId();
  return { roster: { ...roster, players: { ...roster.players, [id]: { name: given, devices: [], createdAt: now } } }, id };
}

export function renamePlayer(roster: Roster, id: string, name: string): Roster {
  const player = roster.players[id];
  const given = playerNameOf(name);
  if (!player || given === null) return roster;
  return { ...roster, players: { ...roster.players, [id]: { ...player, name: given } } };
}

/** Forgets a player and every page shared with them. */
export function removePlayer(roster: Roster, id: string): Roster {
  if (!(id in roster.players)) return roster;
  const { [id]: _removed, ...players } = roster.players;
  let next: Roster = { ...roster, players };
  for (const [path, shared] of Object.entries(roster.shares)) {
    if (!(id in shared)) continue;
    const { [id]: _gone, ...rest } = shared;
    next = withShares(next, path, rest);
  }
  return next;
}

/**
 * `from` is the same person as `into` (who joined from another device): `into` takes their
 * devices and their pages, the widest access of the two where both had one, and `from` goes.
 */
export function mergePlayers(roster: Roster, from: string, into: string): Roster {
  const source = roster.players[from];
  const target = roster.players[into];
  if (!source || !target || from === into) return roster;
  const devices = [...new Set([...target.devices, ...source.devices])].slice(-MAX_DEVICES);
  let next: Roster = { ...roster, players: { ...roster.players, [into]: { ...target, devices } } };
  for (const [path, shared] of Object.entries(roster.shares)) {
    const access = shared[from];
    if (access === undefined) continue;
    const kept = shared[into] === 'write' || access === 'write' ? 'write' : 'read';
    next = withShares(next, path, { ...shared, [into]: kept });
  }
  return removePlayer(next, from);
}

/**
 * Sets the shares of every note of `paths` for the players of `changes`: an access shares the
 * note with them (or changes theirs), null takes it back. Players left out keep what they had.
 */
export function setShares(roster: Roster, paths: readonly string[], changes: Readonly<Record<string, ShareAccess | null>>): Roster {
  let next = roster;
  for (const path of paths) {
    const shared: Record<string, ShareAccess> = { ...(next.shares[path] ?? {}) };
    for (const [id, access] of Object.entries(changes)) {
      if (!(id in next.players)) continue;
      if (access === null) delete shared[id];
      else shared[id] = access;
    }
    next = withShares(next, path, shared);
  }
  return next;
}

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** A note or a folder moved: its shares, and those of every note inside it, follow. */
export function movePath(roster: Roster, from: string, to: string): Roster {
  if (!Object.keys(roster.shares).some((path) => within(path, from))) return roster;
  const shares: Record<string, Readonly<Record<string, ShareAccess>>> = {};
  for (const [path, shared] of Object.entries(roster.shares)) shares[within(path, from) ? to + path.slice(from.length) : path] = shared;
  return { ...roster, shares };
}

/** A note or a folder was deleted: its shares, and those of every note inside it, end. */
export function dropPath(roster: Roster, path: string): Roster {
  if (!Object.keys(roster.shares).some((shared) => within(shared, path))) return roster;
  return { ...roster, shares: Object.fromEntries(Object.entries(roster.shares).filter(([shared]) => !within(shared, path))) };
}

/** The notes shared with a player, by path, with the access each gives. */
export function sharesOf(roster: Roster, id: string): Array<{ path: string; access: ShareAccess }> {
  const shared: Array<{ path: string; access: ShareAccess }> = [];
  for (const [path, players] of Object.entries(roster.shares)) {
    const access = players[id];
    if (access !== undefined) shared.push({ path, access });
  }
  return shared.sort((a, b) => a.path.localeCompare(b.path));
}
