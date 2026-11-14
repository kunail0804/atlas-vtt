/**
 * What the files of the GM's online table share (`players.json`, `books.json`, `characters.json`
 * directly in the worlds' folder): one file each for the vault, whatever world the table plays,
 * named by its purpose. They lie in the worlds' folder so world backups hold them, and in no world's
 * folder, since they belong to none. Each is held as one record whose id (`TABLE_FILE_ID`) is not
 * written. A vault without one starts with an empty table; the file is created by its first write.
 * Fields Atlas does not know are kept, and a file of a later format is read and never written.
 */

import type { RecordLayout, StoredRecord } from '../services/recordFiles/recordLayout';
import { CAMPAIGNS_FOLDER } from './campaignPaths';
import { isRecord } from './campaignValues';

/** The id a table file's one record goes by in memory; it is not written. */
export const TABLE_FILE_ID = 'table';

/** Whether this Atlas, which writes `format`, may write the file `stored`: one of a later format is only read. */
export const isOfWritableFormat = (stored: StoredRecord, format: number): boolean => !(typeof stored.format === 'number' && stored.format > format);

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
    isWritable: (stored) => isOfWritableFormat(stored, spec.format),
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
