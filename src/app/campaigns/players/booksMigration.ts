/**
 * The worlds' books files (`booksFile.ts`) merged into the table's one (`tableBooksFile.ts`). The
 * result is a function of the files alone, so two devices that migrate at once write the same file.
 * A character's book that several worlds hold is the one of the world played last (`lastPlayed`, then
 * the world's id), whole. A player's own book (`player:<id>`) follows the player's id in the table's
 * players file (`migratedIds`), and own books that become one keep the notes and pins of all of them,
 * the world played last first.
 */

import { mergeBooks } from '../../online/gm/book/bookMigration';
import { isEmptyBook, readStoredBook, type StoredBook } from '../../online/gm/book/bookStore';
import { ownBookOf, playerOfBook } from '../../online/gm/book/playerWritings';
import { isRecord } from '../campaignValues';
import { byRecency, type WorldFile } from '../tableFileLayout';
import { isBookKey, type StoredBooks } from './booksFile';
import { emptyTableBooks } from './tableBooksFile';
import type { MigratedIds } from './tablePlayersFile';

/** A player's own book as carried over: as one world's file held it, or the notes and pins of several. */
interface OwnBook {
  readonly raw: unknown;
  readonly book: StoredBook;
  readonly merged: boolean;
}

/** `a` with the notes and pins of `b` it lacks: all a player writes into their own book. */
function withWritings(a: StoredBook, b: StoredBook): StoredBook {
  const united = mergeBooks(a, b);
  return { ...a, notes: united.notes, pins: united.pins };
}

/** The table's books file made from the worlds' files; null where no world has a book to carry over. */
export function mergeWorldBooks(worlds: readonly WorldFile<StoredBooks>[], migratedIds: MigratedIds): StoredBooks | null {
  const characters = new Map<string, unknown>();
  const own = new Map<string, OwnBook>();
  for (const { stored } of byRecency(worlds)) {
    const renamed = migratedIds[stored.id] ?? {};
    for (const [key, raw] of Object.entries(isRecord(stored.books) ? stored.books : {})) {
      const book = isBookKey(key) ? readStoredBook(raw) : null;
      if (book === null || isEmptyBook(book)) continue;
      const player = playerOfBook(key);
      if (player === null) {
        if (!characters.has(key)) characters.set(key, raw);
        continue;
      }
      const ownKey = ownBookOf(Object.hasOwn(renamed, player) ? renamed[player]! : player);
      const held = own.get(ownKey);
      own.set(ownKey, held === undefined ? { raw, book, merged: false } : { raw: null, book: withWritings(held.book, book), merged: true });
    }
  }
  if (characters.size + own.size === 0) return null;
  const books = [...characters, ...[...own].map(([key, { raw, book, merged }]): [string, unknown] => [key, merged ? book : raw])];
  // Built from entries, so a key such as `__proto__` is a key like any other.
  return { ...emptyTableBooks(), books: Object.fromEntries(books) };
}
