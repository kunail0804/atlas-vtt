import { EMPTY_BOOK, isEmptyBook, type StoredBook } from './bookStore.ts';

/** What names a character whose token was placed from no library token: its book lives in memory only. */
export const UNPLACED_PREFIX = 'token:';

/** Where the books of a campaign are kept: a character's by its library token id, what a player wrote by `ownBookOf`. */
export interface BookSource {
  /** A character's book as it is kept; undefined for none. */
  read(characterId: string): StoredBook | undefined;
  /** Keeps a character's book (an empty one takes it away). False when it cannot be kept, as when no campaign is played or its file is of a later format. */
  write(characterId: string, book: StoredBook): boolean;
}

/** Who wrote into a book: the table (its player, a handed item) or the GM from the character's sheet. */
export type BookWriter = 'table' | 'gm';

/** Hears of each book kept: whose and who wrote it. */
export type ShelfListener = (characterId: string, by: BookWriter) => void;

/**
 * The books the GM keeps, one per character. A book is its character's, so whoever plays that
 * character next finds it again. They are kept by the source (the campaign's books file); a book
 * that cannot be kept there, and one of a token that is no library token's, stays in memory for
 * as long as the shelf lives.
 */
export class BookShelf {
  private readonly memory = new Map<string, StoredBook>();
  private readonly listeners = new Set<ShelfListener>();

  constructor(private readonly source: BookSource = { read: () => undefined, write: () => false }) {}

  /** A character's book; an empty one while nothing was written into it. */
  of(characterId: string): StoredBook {
    return this.memory.get(characterId) ?? this.source.read(characterId) ?? EMPTY_BOOK;
  }

  /**
   * Forgets the books held in memory for want of a source, but those of tokens that are no library
   * token's: from now on the source (a campaign's books file just bound) holds each character's.
   */
  forgetKept(): void {
    for (const characterId of [...this.memory.keys()]) if (!characterId.startsWith(UNPLACED_PREFIX)) this.memory.delete(characterId);
  }

  /** Keeps a character's book as it is now, and tells the listeners who wrote it. */
  keep(characterId: string, book: StoredBook, by: BookWriter = 'table'): void {
    if (!characterId.startsWith(UNPLACED_PREFIX) && this.source.write(characterId, book)) {
      this.memory.delete(characterId);
    } else if (isEmptyBook(book)) {
      this.memory.delete(characterId);
    } else {
      this.memory.set(characterId, book);
    }
    for (const listener of [...this.listeners]) listener(characterId, by);
  }

  /** Hears of every book kept from now on; returns what stops it. */
  subscribe(listener: ShelfListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
