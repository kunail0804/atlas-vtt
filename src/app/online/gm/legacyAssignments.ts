import type { TablePlayers } from '../../campaigns/players/TablePlayers';
import { TABLE_PLAYERS_ID } from '../../campaigns/players/tablePlayersFile';
import { assignmentsFrom, holdsAssignments, NO_ASSIGNMENTS, withCarriedAssignments, type TokenAssignments } from '../../campaigns/players/tokenAssignments';
import { isRecord } from '../../campaigns/campaignValues';

/** The token owners and player tokens an older Atlas kept in this device's data (`ownership` in `online.json`); none where there are none. */
export function readLegacyAssignments(ownership: unknown): TokenAssignments {
  const record = isRecord(ownership) ? ownership : {};
  const read = assignmentsFrom(record.owners, record.playerTokens);
  return Object.keys(read.owners).length > 0 || Object.keys(read.playerTokens).length > 0 ? read : NO_ASSIGNMENTS;
}

/** `carried` with each owner called what the table's players file calls them, by the ids of the world `campaignId`. */
function renamedOwners(carried: TokenAssignments, renamed: Readonly<Record<string, string>>): TokenAssignments {
  const owners = Object.fromEntries(Object.entries(carried.owners).map(([tokenId, owner]) => [tokenId, renamed[owner] ?? owner]));
  return { ...carried, owners };
}

/**
 * Carries the assignments into the table's players file, played on the world `campaignId`, whose
 * player ids the file may call otherwise since the worlds' players were merged; what the file already
 * assigns stays the file's. Settles once the file is on disk: true when it holds them then, false
 * where it cannot be written or its write failed, and then the data keeps them.
 */
export async function carryAssignmentsOver(carried: TokenAssignments, players: Pick<TablePlayers, 'change' | 'flush' | 'onDisk' | 'migratedIds'>, campaignId: string): Promise<boolean> {
  const renamed = renamedOwners(carried, players.migratedIds()[campaignId] ?? {});
  if (!players.change((stored) => withCarriedAssignments(stored, renamed))) return false;
  await players.flush();
  // The queue of writes reports no failure, so the file is read back.
  const written = await players.onDisk(TABLE_PLAYERS_ID);
  if (written !== null && holdsAssignments(written, renamed)) return true;
  console.error('[Atlas] The player tokens could not be written to the table\'s players file; they stay in this device\'s data.');
  return false;
}
