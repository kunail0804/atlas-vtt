/**
 * `players.json` directly in the worlds' folder (`tableFileLayout.ts`): who plays at the GM's online
 * table, whatever world it plays (`playersFile.ts`: the players with their codes and characters, the
 * table's `link`, the tokens it assigns, `tokenAssignments.ts`).
 */

import type { RecordLayout } from '../../services/recordFiles/recordLayout';
import { TABLE_FILE_ID, tableFileLayout } from '../tableFileLayout';
import { PLAYERS_FILE, PLAYERS_FORMAT, type StoredPlayers } from './playersFile';

/** The id the file's one record goes by in memory; it is not written. */
export const TABLE_PLAYERS_ID = TABLE_FILE_ID;

/** The format this Atlas writes, which the functions that change the file (`withPlayer`, `withTokenOwners`, …) check. */
export const TABLE_PLAYERS_FORMAT = PLAYERS_FORMAT;

/** An empty players file of the table. */
export const emptyTablePlayers = (): StoredPlayers => ({ id: TABLE_PLAYERS_ID, players: {} });

const FILE = tableFileLayout({ file: PLAYERS_FILE, format: TABLE_PLAYERS_FORMAT, kind: 'table players' });

export const TABLE_PLAYERS_PATH = FILE.path;

/** The table's players file: one file, named after nothing, created at its path (`RecordFiles.createAt`). */
export const TABLE_PLAYERS_LAYOUT: RecordLayout<StoredPlayers> = FILE.layout;
