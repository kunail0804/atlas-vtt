import type { App } from 'obsidian';
import { RecordFiles } from '../services/recordFiles/RecordFiles';
import type { RecordLayout, StoredRecord } from '../services/recordFiles/recordLayout';
import { TABLE_FILE_ID } from './tableFileLayout';

/** Why a table file cannot be changed: it is not read yet, it cannot be read, or it is of a later format. */
export type TableFileBlock = 'loading' | 'unreadable' | 'newer';

/** Where a table file lies and how it is read, written and started. */
export interface TableFileSpec<Stored extends StoredRecord> {
  readonly path: string;
  readonly layout: RecordLayout<Stored>;
  /** Whether this Atlas may write the file: one of a later format is only read. */
  readonly isWritable: (stored: Stored) => boolean;
  /** The file a first write starts from. */
  readonly empty: () => Stored;
}

/**
 * One of the GM's online table's files (`tableFileLayout.ts`): its one record, and the changes made
 * to it. A file that cannot be read keeps the record it held when last read and refuses changes
 * until it can be read again, so a sync that wrote half of it loses nothing.
 */
export abstract class TableFile<Stored extends StoredRecord> extends RecordFiles<Stored> {
  /** Where the file lies. */
  readonly path: string;

  protected constructor(app: App, private readonly spec: TableFileSpec<Stored>) {
    super(app, spec.layout);
    this.path = spec.path;
  }

  /** The file's record, the last one read where it cannot be read now; undefined while the vault has none or none was read. */
  stored(): Stored | undefined {
    return this.entries().find((entry) => entry.id === TABLE_FILE_ID);
  }

  /** Why the file cannot be changed now, or null where it can. */
  blocked(): TableFileBlock | null {
    if (!this.isLoaded()) return 'loading';
    if (this.isUnreadable(this.path)) return 'unreadable';
    const stored = this.stored();
    return stored !== undefined && !this.spec.isWritable(stored) ? 'newer' : null;
  }

  /**
   * Changes the file, creating it when the vault has none. False where it cannot be changed
   * (`blocked`). `change` must be a pure function of the file it is given: it runs more than once,
   * on the copy in memory now and on what the disk holds once the write lands, so anything random or
   * timed is drawn before and passed in.
   */
  change(change: (stored: Stored) => Stored): boolean {
    if (this.blocked() !== null) return false;
    if (this.stored() !== undefined) this.update(TABLE_FILE_ID, change);
    else this.createAt(this.path, change(this.spec.empty()), change);
    return true;
  }
}
