/**
 * `players.json` directly in the worlds' folder (`tableFileLayout.ts`): who plays at the GM's online
 * table, whatever world it plays. It holds what a world's players file held (`playersFile.ts`: the
 * players with their codes and characters, the table's `link`, the tokens it assigns,
 * `tokenAssignments.ts`) and, once
 * the worlds' files were carried into it, `migratedIds`: `{ <world id>: { <old player id>: <player
 * id> } }`, what each player of each world is called here.
 */

import type { RecordLayout } from '../../services/recordFiles/recordLayout';
import { isRecord } from '../campaignValues';
import { TABLE_FILE_ID, tableFileLayout } from '../tableFileLayout';
import { PLAYER_ID_PATTERN } from '../../online/protocol/index';
import { PLAYERS_FILE, PLAYERS_FORMAT, type StoredPlayers } from './playersFile';

/** The id the file's one record goes by in memory; it is not written. */
export const TABLE_PLAYERS_ID = TABLE_FILE_ID;

/**
 * The format this Atlas writes. The file has the shape of a world's players file, whose functions
 * (`withPlayer`, `withTokenOwners`, …) change it and check this same number.
 */
export const TABLE_PLAYERS_FORMAT = PLAYERS_FORMAT;

/** Old player ids by world, and what each is called in the table's file. */
export type MigratedIds = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** An empty players file of the table. */
export const emptyTablePlayers = (): StoredPlayers => ({ id: TABLE_PLAYERS_ID, players: {} });

const FILE = tableFileLayout({ file: PLAYERS_FILE, format: TABLE_PLAYERS_FORMAT, kind: 'table players' });

export const TABLE_PLAYERS_PATH = FILE.path;

/** The table's players file: one file, named after nothing, created at its path (`RecordFiles.createAt`). */
export const TABLE_PLAYERS_LAYOUT: RecordLayout<StoredPlayers> = FILE.layout;

const MAX_WORLD_ID = 200;

/** The file's `migratedIds`: what cannot be read (an id that is no player id, a world id too long) is left out. */
export function readMigratedIds(stored: StoredPlayers): MigratedIds {
  const ids: Record<string, Record<string, string>> = {};
  for (const [worldId, world] of Object.entries(isRecord(stored.migratedIds) ? stored.migratedIds : {})) {
    if (worldId === '' || worldId.length > MAX_WORLD_ID || !isRecord(world)) continue;
    const kept = Object.entries(world).filter((entry): entry is [string, string] => PLAYER_ID_PATTERN.test(entry[0]) && typeof entry[1] === 'string' && PLAYER_ID_PATTERN.test(entry[1]));
    if (kept.length > 0) ids[worldId] = Object.fromEntries(kept);
  }
  return ids;
}

/** The ids a player of the table had in the worlds before it, other than their own, in order, for the relay (`CampaignSeat.was`). */
export function earlierIdsOf(ids: MigratedIds, playerId: string): string[] {
  const earlier = new Set<string>();
  for (const world of Object.values(ids)) {
    for (const [oldId, newId] of Object.entries(world)) if (newId === playerId && oldId !== playerId) earlier.add(oldId);
  }
  // Ordered by code units, not by locale, so every device tells the relay the same list.
  return [...earlier].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
