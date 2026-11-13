/**
 * `books.json` directly in the worlds' folder (`tableFileLayout.ts`): what the players of the GM's
 * online table wrote into the books of their characters, whatever world it plays. `{ format, books:
 * { <library token id>: <book>, 'player:<player id>': <book> } }`, the shape of a world's books file
 * (`booksFile.ts`) without its `campaignId`, so `bookIn` and `withBook` read and change both. Where
 * the vault had none, the worlds' books files are carried into it (`booksMigration.ts`).
 */

import type { RecordLayout } from '../../services/recordFiles/recordLayout';
import { TABLE_FILE_ID, tableFileLayout } from '../tableFileLayout';
import { BOOKS_FILE, BOOKS_FORMAT, type StoredBooks } from './booksFile';

const FILE = tableFileLayout({ file: BOOKS_FILE, format: BOOKS_FORMAT, kind: 'table books' });

export const TABLE_BOOKS_PATH = FILE.path;

export const TABLE_BOOKS_LAYOUT: RecordLayout<StoredBooks> = FILE.layout;

/** An empty books file of the table. */
export const emptyTableBooks = (): StoredBooks => ({ id: TABLE_FILE_ID, books: {} });
