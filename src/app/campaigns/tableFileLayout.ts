/**
 * What the files of the GM's online table share (`players.json`, `books.json`, `characters.json`
 * directly in the worlds' folder): one file each for the vault, whatever world the table plays,
 * named by its purpose. They lie in the worlds' folder so world backups hold them, and in no world's
 * folder, since they belong to none; a world's file of the same name lies one folder deeper. Each is
 * held as one record whose id (`TABLE_FILE_ID`) is not written. Fields Atlas does not know are kept,
 * and a file of a later format is read and never written.
 */

import type { App } from 'obsidian';
import type { RecordLayout, StoredRecord } from '../services/recordFiles/recordLayout';
import type { RecordFiles } from '../services/recordFiles/RecordFiles';
import { CAMPAIGNS_FOLDER } from './campaignPaths';
import { isRecord } from './campaignValues';

/** The id a table file's one record goes by in memory; it is not written. */
export const TABLE_FILE_ID = 'table';

export interface TableFileSpec {
  /** The file's name in the worlds' folder. */
  readonly file: string;
  /** The format this Atlas writes. */
  readonly format: number;
  /** What the file is, for messages. */
  readonly kind: string;
}

export interface TableFileLayout {
  /** Where the file lies. */
  readonly path: string;
  /** Whether this Atlas may write the file: one of a later format is only read. */
  readonly isWritable: (stored: StoredRecord) => boolean;
  readonly layout: RecordLayout<StoredRecord>;
}

/** The layout of the table's file `spec.file`, created at its path (`RecordFiles.createAt`). */
export function tableFileLayout(spec: TableFileSpec): TableFileLayout {
  const path = `${CAMPAIGNS_FOLDER}/${spec.file}`;

  const read = (text: string): StoredRecord | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) ? { ...parsed, id: TABLE_FILE_ID } : null;
    } catch {
      return null;
    }
  };

  const text = (record: StoredRecord): string => {
    const { id: _id, format, ...rest } = record;
    const kept = typeof format === 'number' && format > spec.format ? format : spec.format;
    return `${JSON.stringify({ format: kept, ...rest }, null, 2)}\n`;
  };

  return {
    path,
    isWritable: (stored) => !(typeof stored.format === 'number' && stored.format > spec.format),
    layout: {
      root: CAMPAIGNS_FOLDER,
      kind: spec.kind,
      isRecordPath: (candidate) => candidate === path,
      read,
      text,
      namedPath: (candidate) => candidate,
      recordPathIn: (candidate) => candidate,
      freeNamedPath: () => path,
      isNamedAfter: () => true,
    },
  };
}

/**
 * Writes the table's file made from the worlds' files (`made`), where the vault has none (not even
 * one that cannot be read) and `made` finds something to carry over. The worlds' files stay as they
 * are, for older versions of Atlas. `made` must be a function of the files alone, so two devices that
 * migrate at once write the same file; one that arrived from another device meanwhile stays.
 */
export async function carryWorldsInto<Stored extends StoredRecord>(app: App, files: RecordFiles<Stored>, path: string, made: () => Promise<Stored | null>): Promise<void> {
  const { adapter } = app.vault;
  if (await adapter.exists(path)) return;
  const merged = await made();
  // Another device's file may have arrived while the worlds were read: it is the same, or newer.
  if (merged === null || files.pathOf(TABLE_FILE_ID) !== null || await adapter.exists(path)) return;
  files.createAt(path, merged, (onDisk) => onDisk);
  await files.flush();
}

/** When each world was last played, by id (0 for never), which the migrations rank worlds by. */
export function lastPlayedOf(worlds: readonly StoredRecord[]): ReadonlyMap<string, number> {
  return new Map(worlds.map((world) => [world.id, typeof world.lastPlayed === 'number' && Number.isFinite(world.lastPlayed) ? world.lastPlayed : 0]));
}

/** A world's file and when the world was last played (0 for never). */
export interface WorldFile<Stored extends StoredRecord> {
  readonly stored: Stored;
  readonly lastPlayed: number;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The worlds' files, the world played last first, then by world id in code units, so every device ranks them alike. */
export function byRecency<Stored extends StoredRecord>(worlds: readonly WorldFile<Stored>[]): WorldFile<Stored>[] {
  return [...worlds].sort((a, b) => b.lastPlayed - a.lastPlayed || compareText(a.stored.id, b.stored.id));
}
