import { isAssetId } from '../../campaigns/campaignValues';
import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../protocol/index.ts';
import { playerOriginOf, seatsOf, type CreatedTable } from './createdTable.ts';
import { readGate, type GateSettings } from './joinGate.ts';

/** The longest map path kept. */
const MAX_MAP_PATH = 1000;

/**
 * A running table as the companion's data keeps it, so a reload of Obsidian or of the companion comes
 * back to it: its code and host secret, the world it plays (or none), the map file players were shown, and
 * its gates (the join code is kept here like the host secret: the relay has only its hash). Cleared
 * when the GM stops the table or the server ends it.
 */
export interface SavedTable extends CreatedTable {
  /** The world the table plays, chosen by the GM at the start or during the session; null for none. */
  readonly campaignId: string | null;
  /** The shared scene's map file, found again by this path; null until a map was shared. */
  readonly mapPath: string | null;
  /** The join code and the two switches; a table saved before it had gates gets new ones, both on. */
  readonly gate: GateSettings;
}

/**
 * The saved table from the plugin's data, each field checked; null when there is none or it is
 * unreadable. A table plays the world it names, and none where it names none.
 */
export function readSavedTable(data: unknown): SavedTable | null {
  if (typeof data !== 'object' || data === null) return null;
  const { code, secret, campaignId, mapPath, maxPlayers, gate } = data as Record<string, unknown>;
  const playerOrigin = playerOriginOf((data as Record<string, unknown>).playerOrigin);
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || !SECRET_PATTERN.test(secret) || playerOrigin === null) return null;
  const path = typeof mapPath === 'string' && mapPath !== '' && mapPath.length <= MAX_MAP_PATH ? mapPath : null;
  return { code, secret, campaignId: isAssetId(campaignId) ? campaignId : null, maxPlayers: seatsOf(maxPlayers), playerOrigin, mapPath: path, gate: readGate(gate) };
}
