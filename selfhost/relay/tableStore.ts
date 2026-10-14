import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_PLAYERS, PLAYER_ID_PATTERN, TABLE_CODE_PATTERN, playerName } from '../../src/app/online/protocol/relay.ts';

/** A player the table knows: their key is kept as its hash only. */
export interface SavedPlayer {
  readonly id: string;
  readonly name: string;
  readonly keyHash: string;
}

export interface SavedGate {
  /** The hash of the join code players must give, or null when none is asked. */
  readonly codeHash: string | null;
  /** Whether newcomers wait for the GM's answer. */
  readonly ask: boolean;
}

export interface SavedTable {
  readonly code: string;
  readonly secretHash: string;
  readonly maxPlayers: number;
  readonly gate: SavedGate;
  readonly players: readonly SavedPlayer[];
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPlayer(value: unknown): SavedPlayer | null {
  if (!isRecord(value)) return null;
  const { id, name, keyHash } = value;
  if (typeof id !== 'string' || !PLAYER_ID_PATTERN.test(id)) return null;
  if (typeof keyHash !== 'string' || !HASH_PATTERN.test(keyHash)) return null;
  const shown = playerName(name);
  return shown === null ? null : { id, name: shown, keyHash };
}

function readGate(value: unknown): SavedGate {
  if (!isRecord(value)) return { codeHash: null, ask: true };
  const codeHash = typeof value.codeHash === 'string' && HASH_PATTERN.test(value.codeHash) ? value.codeHash : null;
  return { codeHash, ask: value.ask !== false };
}

/** A table read from disk, or null when it cannot be one; a player that cannot be read is dropped. */
function readTable(value: unknown): SavedTable | null {
  if (!isRecord(value)) return null;
  const { code, secretHash, maxPlayers, players } = value;
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code)) return null;
  if (typeof secretHash !== 'string' || !HASH_PATTERN.test(secretHash)) return null;
  const seats = typeof maxPlayers === 'number' && Number.isInteger(maxPlayers) && maxPlayers >= 1 && maxPlayers <= MAX_PLAYERS ? maxPlayers : MAX_PLAYERS;
  const known: SavedPlayer[] = [];
  if (Array.isArray(players)) {
    for (const entry of players) {
      const player = readPlayer(entry);
      if (player !== null) known.push(player);
    }
  }
  return { code, secretHash, maxPlayers: seats, gate: readGate(value.gate), players: known };
}

/**
 * The relay's tables on disk, so a restarted relay (a new container, an idle stop) still knows them:
 * the GM's plugin comes back with the table's secret, and players with their keys.
 */
export class TableStore {
  private readonly file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'tables.json');
  }

  load(): SavedTable[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      console.error(`tables file is not JSON, starting without tables: ${this.file}`);
      return [];
    }
    if (!isRecord(value) || !Array.isArray(value.tables)) return [];
    const tables: SavedTable[] = [];
    for (const entry of value.tables) {
      const table = readTable(entry);
      if (table !== null) tables.push(table);
    }
    return tables;
  }

  save(tables: readonly SavedTable[]): void {
    // Written beside the file, then renamed over it: a stop in the middle never leaves half a file.
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ tables }, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
