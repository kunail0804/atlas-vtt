import type { App } from 'obsidian';
import type { StoredBook } from '../../online/gm/book/bookStore';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { TABLE_FILE_ID } from '../tableFileLayout';
import { bookIn, isWritable, type StoredBooks } from './booksFile';
import { emptyTableBooks, TABLE_BOOKS_LAYOUT, TABLE_BOOKS_PATH } from './tableBooksFile';

/**
 * The books of the GM's online table (`tableBooksFile.ts`): one file for the vault, whatever world
 * the table plays. One per app, opened by the plugin and released when it unloads; read with `load`.
 */
export class TableBooks extends RecordFiles<StoredBooks> {
  private static readonly instances = new WeakMap<App, TableBooks>();

  static open(app: App): TableBooks {
    let files = TableBooks.instances.get(app);
    if (!files) {
      files = new TableBooks(app);
      TableBooks.instances.set(app, files);
    }
    return files;
  }

  /** The app's table books once the plugin opened them; undefined before. */
  static forApp(app: App | undefined): TableBooks | undefined {
    return app ? TableBooks.instances.get(app) : undefined;
  }

  static release(app: App): void {
    TableBooks.instances.get(app)?.destroy();
    TableBooks.instances.delete(app);
  }

  private constructor(app: App) {
    super(app, TABLE_BOOKS_LAYOUT);
  }

  /** A character's book, or a player's own (`ownBookOf`); undefined for none. */
  of(characterId: string): StoredBook | undefined {
    const stored = this.stored();
    return stored ? bookIn(stored, characterId) : undefined;
  }

  /** Whether `change` can be made: the file was read and, where it exists, is of a format this Atlas writes. */
  canChange(): boolean {
    const stored = this.stored();
    return this.isLoaded() && (stored === undefined || isWritable(stored));
  }

  /**
   * Changes the file, creating it when the vault has none. False where it cannot be changed
   * (`canChange`). `change` must be a pure function of the file it is given: it runs more than once,
   * on the copy in memory now and on what the disk holds once the write lands, so anything random or
   * timed is drawn before and passed in.
   */
  change(change: (stored: StoredBooks) => StoredBooks): boolean {
    if (!this.canChange()) return false;
    if (this.stored() !== undefined) this.update(TABLE_FILE_ID, change);
    else this.createAt(TABLE_BOOKS_PATH, change(emptyTableBooks()), change);
    return true;
  }

  /** What the disk holds of the file now; null for none. */
  onDiskBooks(): Promise<StoredBooks | null> {
    return this.onDisk(TABLE_FILE_ID);
  }

  private stored(): StoredBooks | undefined {
    return this.entries().find((entry) => entry.id === TABLE_FILE_ID);
  }
}
