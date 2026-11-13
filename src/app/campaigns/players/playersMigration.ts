/**
 * The worlds' players files (`playersFile.ts`) merged into the table's one (`tablePlayersFile.ts`).
 * The result is a function of the files alone, so two devices that migrate at once write the same
 * file. Two players of one name (`playerNameKey`) are one player, who keeps the id and code of the
 * one added first (`addedAt`, then the id) and the characters of both; a character two players play
 * goes to the one of the world played last (`lastPlayed`), as do the table's link and the tokens two
 * worlds assign differently. Where the id or code kept is another player's already (a world folder
 * copied, then a player renamed), one is derived from the world and the old id.
 */

import { MAX_CAMPAIGN_PLAYERS, playerNameKey } from '../../online/protocol/index';
import { fnv1a32 } from '../../utils/hashing';
import { isRecord } from '../campaignValues';
import { linkOf, readPlayers, type StoredPlayers } from './playersFile';
import { emptyTablePlayers } from './tablePlayersFile';
import { readTokenAssignments } from './tokenAssignments';

/** A world's players file and when the world was last played (0 for never). */
export interface WorldPlayers {
  readonly stored: StoredPlayers;
  readonly lastPlayed: number;
}

/** A player as one world's file has them. */
interface WorldPlayer {
  readonly worldId: string;
  /** The world's place, the one played last first. */
  readonly rank: number;
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly characters: readonly string[];
  readonly addedAt: number | undefined;
}

/** One player of the table: every world's player of one name, the one added first leading. */
interface MergedPlayer {
  readonly members: readonly WorldPlayer[];
  readonly id: string;
  readonly code: string;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one added first before the other: a player without a time comes after those with one. */
function addedFirst(a: WorldPlayer, b: WorldPlayer): number {
  const at = (player: WorldPlayer): number => player.addedAt ?? Number.POSITIVE_INFINITY;
  return at(a) - at(b) || compareText(a.id, b.id) || a.rank - b.rank;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A player id (20 base32 characters) derived from `seed`, the first of its series no one has. */
function derivedId(seed: string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt++) {
    let id = '';
    for (let part = 0; part < 4; part++) {
      const hash = fnv1a32(`${seed}#${attempt}:${part}`);
      for (let index = 0; index < 5; index++) id += BASE32[(hash >>> (index * 5)) & 31];
    }
    if (!taken.has(id)) return id;
  }
}

/** A six-digit code derived from `seed`, the first of its series no one has. */
function derivedCode(seed: string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt++) {
    const code = String(fnv1a32(`${seed}#code${attempt}`) % 1_000_000).padStart(6, '0');
    if (!taken.has(code)) return code;
  }
}

function addedAtOf(stored: StoredPlayers, id: string): number | undefined {
  const entry = isRecord(stored.players) ? stored.players[id] : undefined;
  return isRecord(entry) && typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : undefined;
}

/** The worlds, the one played last first, then by id. */
function byRecency(worlds: readonly WorldPlayers[]): WorldPlayers[] {
  return [...worlds].sort((a, b) => b.lastPlayed - a.lastPlayed || compareText(a.stored.id, b.stored.id));
}

/** Every world's players, grouped by name, each group the one added first leading, the groups in that order. */
function groupsByName(worlds: readonly WorldPlayers[]): WorldPlayer[][] {
  const groups = new Map<string, WorldPlayer[]>();
  worlds.forEach(({ stored }, rank) => {
    for (const player of readPlayers(stored)) {
      const key = playerNameKey(player.name);
      const member: WorldPlayer = { ...player, worldId: stored.id, rank, addedAt: addedAtOf(stored, player.id) };
      groups.set(key, [...(groups.get(key) ?? []), member]);
    }
  });
  const sorted = [...groups.values()].map((members) => [...members].sort(addedFirst));
  return sorted.sort((a, b) => addedFirst(a[0] as WorldPlayer, b[0] as WorldPlayer));
}

/** The players of the table, at most `MAX_CAMPAIGN_PLAYERS`: each keeps its first member's id and code where no player before it has them. */
function mergedPlayers(groups: readonly WorldPlayer[][]): MergedPlayer[] {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const merged: MergedPlayer[] = [];
  for (const members of groups.slice(0, MAX_CAMPAIGN_PLAYERS)) {
    const first = members[0] as WorldPlayer;
    const seed = `${first.worldId}:${first.id}`;
    const id = ids.has(first.id) ? derivedId(seed, ids) : first.id;
    const code = members.map((member) => member.code).find((candidate) => !codes.has(candidate)) ?? derivedCode(seed, codes);
    ids.add(id);
    codes.add(code);
    merged.push({ members, id, code });
  }
  return merged;
}

/**
 * The table's players file made from the worlds' files; null where no world has anything to carry
 * over (no player, link or assigned token). Every player of every world the table keeps is listed in
 * `migratedIds`, under their own id too where it stays the same.
 */
export function mergeWorldPlayers(worlds: readonly WorldPlayers[]): StoredPlayers | null {
  const ordered = byRecency(worlds);
  const players = mergedPlayers(groupsByName(ordered));
  const migratedIds: Record<string, Record<string, string>> = {};
  for (const { stored } of ordered) migratedIds[stored.id] = {};
  for (const player of players) {
    for (const member of player.members) (migratedIds[member.worldId] as Record<string, string>)[member.id] = player.id;
  }

  // A character goes to the player of the world played last that lists it.
  const owners = new Map<string, string>();
  const characters = new Map<string, string[]>(players.map((player) => [player.id, []]));
  const membersByRank = players.flatMap((player) => player.members.map((member) => ({ member, id: player.id }))).sort((a, b) => a.member.rank - b.member.rank);
  for (const { member, id } of membersByRank) {
    for (const characterId of member.characters) {
      if (owners.has(characterId)) continue;
      owners.set(characterId, id);
      characters.get(id)?.push(characterId);
    }
  }

  const tokenOwners: Record<string, string> = {};
  const playerTokens: Record<string, Record<string, boolean>> = {};
  for (const { stored } of ordered) {
    const assignments = readTokenAssignments(stored);
    const renamed = migratedIds[stored.id] ?? {};
    for (const [tokenId, owner] of Object.entries(assignments.owners)) {
      const now = renamed[owner];
      if (now !== undefined && !(tokenId in tokenOwners)) tokenOwners[tokenId] = now;
    }
    for (const [mapPath, marks] of Object.entries(assignments.playerTokens)) {
      const scene = (playerTokens[mapPath] ??= {});
      for (const [tokenId, player] of Object.entries(marks)) if (!(tokenId in scene)) scene[tokenId] = player;
    }
  }

  const link = ordered.map(({ stored }) => linkOf(stored)).find((found) => found !== null) ?? null;
  if (players.length === 0 && link === null && Object.keys(tokenOwners).length === 0 && Object.keys(playerTokens).length === 0) return null;

  const stored: Record<string, unknown> = {};
  for (const player of players) {
    const first = player.members[0] as WorldPlayer;
    stored[player.id] = { name: first.name, code: player.code, characters: characters.get(player.id) ?? [], ...(first.addedAt !== undefined && { addedAt: first.addedAt }) };
  }
  return {
    ...emptyTablePlayers(),
    ...(link !== null && { link }),
    players: stored,
    ...(Object.keys(tokenOwners).length > 0 && { tokenOwners }),
    ...(Object.keys(playerTokens).length > 0 && { playerTokens }),
    migratedIds,
  };
}
