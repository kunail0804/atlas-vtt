import type { App } from 'obsidian';
import type { StoredBook } from '../../online/gm/book/bookStore';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { CampaignFiles } from '../CampaignFiles';
import { carryWorldsInto, lastPlayedOf, TABLE_FILE_ID } from '../tableFileLayout';
import { bookIn, isWritable, type StoredBooks } from './booksFile';
import { mergeWorldBooks } from './booksMigration';
import { CampaignBooks } from './CampaignBooks';
import { emptyTableBooks, TABLE_BOOKS_LAYOUT, TABLE_BOOKS_PATH } from './tableBooksFile';
import { TablePlayers } from './TablePlayers';

/**
 * The books of the GM's online table (`tableBooksFile.ts`): one file for the vault, whatever world
 * the table plays. One per app, opened by the plugin and released when it unloads. Before it is ready
 * the worlds' own books files are carried into it where the vault has none yet (`whenReady`), the
 * players' own books following the ids the table's players file gave them, so it waits for that file.
 */
export class TableBooks extends RecordFiles<StoredBooks> {
  private static readonly instances = new WeakMap<App, TableBooks>();
  private readying: Promise<void> | null = null;
  private ready = false;

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

  /**
   * Settles once the file was read and, where the vault had none, the worlds' books files were
   * carried into it (`mergeWorldBooks`). A failed migration is logged and leaves the file as it is.
   */
  whenReady(): Promise<void> {
    return (this.readying ??= this.load()
      .then(() => this.carryWorldsIn())
      .catch((error: unknown) => console.error('[Atlas] Carrying the worlds\' books into the table\'s books file failed:', error))
      .finally(() => {
        this.ready = true;
        this.changed();
      }));
  }

  /** A character's book, or a player's own (`ownBookOf`); undefined for none. */
  of(characterId: string): StoredBook | undefined {
    const stored = this.stored();
    return stored ? bookIn(stored, characterId) : undefined;
  }

  /** Whether `change` can be made: the file was carried over and, where it exists, is of a format this Atlas writes. */
  canChange(): boolean {
    const stored = this.stored();
    return this.ready && (stored === undefined || isWritable(stored));
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

  /** Writes the worlds' books merged into this file, where the vault has none (`carryWorldsInto`). */
  private async carryWorldsIn(): Promise<void> {
    const campaigns = CampaignFiles.forApp(this.app);
    if (campaigns === undefined) return;
    await carryWorldsInto(this.app, this, TABLE_BOOKS_PATH, async () => {
      const players = TablePlayers.forApp(this.app);
      await players?.whenReady();
      await campaigns.load();
      // The worlds' files are read once, for this, and left as they are.
      const worlds = CampaignBooks.reader(this.app);
      try {
        await worlds.load();
        const lastPlayed = lastPlayedOf(campaigns.entries());
        return mergeWorldBooks(worlds.entries().map((stored) => ({ stored, lastPlayed: lastPlayed.get(stored.id) ?? 0 })), players?.migratedIds() ?? {});
      } finally {
        worlds.destroy();
      }
    });
  }
}
