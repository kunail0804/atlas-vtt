/**
 * What the table's books file holds (`tableBooksFile.ts`) and the functions that read and change it:
 * what the players of the table wrote into the books of their characters. `{ format, books: {
 * <library token id>: { items, notes, pins, purse, slots, equipped } } }`. A book is its
 * character's, so whoever plays that character next finds it again, and it follows the library
 * token, not its artwork. What a player writes themselves (notes and pins) lies in a book of their
 * own, `player:<player id>`, which no library token's id is. Fields Atlas does not know are kept.
 */

import { isEmptyBook, readStoredBook, type StoredBook } from '../../online/gm/book/bookStore';
import type { StoredRecord } from '../../services/recordFiles/recordLayout';
import { isAssetId, isRecord } from '../campaignValues';
import { isOfWritableFormat } from '../tableFileLayout';

export const BOOKS_FILE = 'books.json';
/** The format this Atlas writes; a file of a later one is read and never written. */
export const BOOKS_FORMAT = 1;

/** The table's books file as stored. */
export type StoredBooks = StoredRecord;

/** Whether this Atlas may write the file: one of a later format is only read. */
export const isWritable = (stored: StoredBooks): boolean => isOfWritableFormat(stored, BOOKS_FORMAT);

/** Whether a book can be kept in the file under this key: a library token's id, or a player's own (`ownBookOf`). */
export const isBookKey = isAssetId;

/** The book of the character `characterId` the file holds; undefined for none. */
export function bookIn(stored: StoredBooks, characterId: string): StoredBook | undefined {
  if (!isRecord(stored.books) || !Object.hasOwn(stored.books, characterId)) return undefined;
  return readStoredBook(stored.books[characterId]) ?? undefined;
}

/**
 * The file with the book of `characterId` set to `book` (removed when it is empty); every other
 * character's entry stays exactly as the file held it.
 */
export function withBook(stored: StoredBooks, characterId: string, book: StoredBook): StoredBooks {
  if (!isWritable(stored) || !isBookKey(characterId)) return stored;
  const { [characterId]: _removed, ...others } = isRecord(stored.books) ? stored.books : {};
  return { ...stored, books: isEmptyBook(book) ? others : { ...others, [characterId]: book } };
}
