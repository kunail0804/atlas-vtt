import { EMPTY_BOOK, isEmptyBook, type BookData, type StoredBook } from './bookStore.ts';

/** Who wrote into a book: the table (its player, a handed item) or the GM from the character's sheet. */
export type BookWriter = 'table' | 'gm';

/** Hears of each book kept: whose and who wrote it. */
export type ShelfListener = (collection: string, character: string, by: BookWriter) => void;

/**
 * The books the GM keeps, one per character of a collection. They outlive tables and players: a
 * book is its character's, so whoever plays that character next finds it again. `save` hears of
 * every change; the books are written with the rest of the companion's data.
 */
export class BookShelf {
  private readonly books = new Map<string, Map<string, StoredBook>>();
  private readonly save: () => void;
  private readonly listeners = new Set<ShelfListener>();

  constructor(data: BookData = {}, save: () => void = () => undefined) {
    this.save = save;
    for (const [collection, characters] of Object.entries(data)) this.books.set(collection, new Map(Object.entries(characters)));
  }

  /** A character's book; an empty one while nothing was written into it. */
  of(collection: string, character: string): StoredBook {
    return this.books.get(collection)?.get(character) ?? EMPTY_BOOK;
  }

  /** The collections that keep a book of the character, whatever scene it was played in. */
  collectionsOf(character: string): string[] {
    return [...this.books].filter(([, characters]) => characters.has(character)).map(([collection]) => collection);
  }

  /** Keeps a character's book as it is now. */
  keep(collection: string, character: string, book: StoredBook, by: BookWriter = 'table'): void {
    const characters = this.books.get(collection) ?? new Map<string, StoredBook>();
    if (isEmptyBook(book)) characters.delete(character);
    else characters.set(character, book);
    if (characters.size > 0) this.books.set(collection, characters);
    else this.books.delete(collection);
    this.save();
    for (const listener of [...this.listeners]) listener(collection, character, by);
  }

  subscribe(listener: ShelfListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  toData(): BookData {
    return Object.fromEntries([...this.books].map(([collection, characters]) => [collection, Object.fromEntries(characters)]));
  }
}
