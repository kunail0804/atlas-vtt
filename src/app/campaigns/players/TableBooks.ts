import type { App } from 'obsidian';
import type { StoredBook } from '../../online/gm/book/bookStore';
import { TableFile } from '../TableFile';
import { TABLE_FILE_ID } from '../tableFileLayout';
import { bookIn, isWritable, type StoredBooks } from './booksFile';
import { emptyTableBooks, TABLE_BOOKS_LAYOUT, TABLE_BOOKS_PATH } from './tableBooksFile';

/**
 * The books of the GM's online table (`tableBooksFile.ts`): one file for the vault, whatever world
 * the table plays. One per app, opened by the plugin and released when it unloads; read with `load`.
 */
export class TableBooks extends TableFile<StoredBooks> {
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
    super(app, { path: TABLE_BOOKS_PATH, layout: TABLE_BOOKS_LAYOUT, isWritable, empty: emptyTableBooks });
  }

  /** A character's book, or a player's own (`ownBookOf`); undefined for none. */
  of(characterId: string): StoredBook | undefined {
    const stored = this.stored();
    return stored ? bookIn(stored, characterId) : undefined;
  }

  /** Whether `change` can be made now (`blocked`). */
  canChange(): boolean {
    return this.blocked() === null;
  }

  /** What the disk holds of the file now; null for none. */
  onDiskBooks(): Promise<StoredBooks | null> {
    return this.onDisk(TABLE_FILE_ID);
  }
}
