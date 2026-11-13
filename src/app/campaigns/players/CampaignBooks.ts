import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { BOOKS_LAYOUT, type StoredBooks } from './booksFile';

/**
 * The worlds' own books files (`booksFile.ts`), one per world folder whose players kept books before
 * the books moved into one file for the vault (`TableBooks`). Atlas only reads them, once, to carry
 * them over; they stay on disk for older versions.
 */
export class CampaignBooks extends RecordFiles<StoredBooks> {
  /** A reader of the worlds' books files, to be destroyed once read. */
  static reader(app: App): CampaignBooks {
    return new CampaignBooks(app);
  }

  private constructor(app: App) {
    super(app, BOOKS_LAYOUT);
  }
}
