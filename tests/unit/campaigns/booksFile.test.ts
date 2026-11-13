import { afterEach, describe, expect, it } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { bookIn, isBooksPath, withBook } from '../../../src/app/campaigns/players/booksFile';
import { emptyTableBooks, TABLE_BOOKS_PATH } from '../../../src/app/campaigns/players/tableBooksFile';
import { TableBooks } from '../../../src/app/campaigns/players/TableBooks';
import { EMPTY_BOOK, type StoredBook } from '../../../src/app/online/gm/book/bookStore';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const FOLDER = `${CAMPAIGNS_FOLDER}/Witherwild`;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1 })}\n`;
const noteId = (count: number): string => count.toString(16).padStart(24, '0');
const bookWith = (count: number): StoredBook => ({ ...EMPTY_BOOK, notes: [{ id: noteId(count), title: `Note ${count}`, body: 'Body', at: count }] });

const opened: ReturnType<typeof createInMemoryApp>[] = [];
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function device(files: Record<string, string> = { [`${FOLDER}/campaign.json`]: campaignText }): Promise<{ vault: ReturnType<typeof createInMemoryApp>; books: TableBooks }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  const books = TableBooks.open(vault.app);
  await books.whenReady();
  return { vault, books };
}

afterEach(() => {
  for (const vault of opened.splice(0)) {
    TableBooks.release(vault.app);
    CampaignFiles.release(vault.app);
  }
});

describe('books.json', () => {
  it('of a world lies directly in its folder; the table\'s lies in the worlds\' folder, in none of them', () => {
    expect(isBooksPath(`${FOLDER}/books.json`)).toBe(true);
    expect(isBooksPath(`${FOLDER}/deeper/books.json`)).toBe(false);
    expect(isBooksPath(`${FOLDER}/players.json`)).toBe(false);
    expect(TABLE_BOOKS_PATH).toBe(`${CAMPAIGNS_FOLDER}/books.json`);
    expect(isBooksPath(TABLE_BOOKS_PATH)).toBe(false);
  });

  it('sets one character\'s book and leaves every other entry as the file held it', () => {
    const held = { ...emptyTableBooks(), books: { A: bookWith(1), B: { ...bookWith(2), futureField: { kept: true } } } };
    const next = withBook(held, 'A', bookWith(3));
    expect(bookIn(next, 'A')?.notes.map((note) => note.id)).toEqual([noteId(3)]);
    expect((next.books as Record<string, unknown>).B).toBe((held.books as Record<string, unknown>).B);
    expect(withBook(next, 'A', EMPTY_BOOK).books).toEqual({ B: (held.books as Record<string, unknown>).B });
  });

  it('of a later format is never written', async () => {
    const later = `${JSON.stringify({ format: 2, books: {} })}\n`;
    const { vault, books } = await device({ [`${FOLDER}/campaign.json`]: campaignText, [TABLE_BOOKS_PATH]: later });
    expect(books.canChange()).toBe(false);
    expect(books.change((stored) => withBook(stored, 'A', bookWith(1)))).toBe(false);
    await books.flush();
    expect(vault.files.get(TABLE_BOOKS_PATH)).toBe(later);
    const stored = emptyTableBooks();
    expect(withBook({ ...stored, format: 2 }, 'A', bookWith(1))).toEqual({ ...stored, format: 2 });
  });

  it('is created when a change finds none, whatever world is played, and read back', async () => {
    const { vault, books } = await device();
    expect(books.canChange()).toBe(true);
    expect(books.change((stored) => withBook(stored, 'A', bookWith(1)))).toBe(true);
    await books.flush();
    const written = JSON.parse(vault.files.get(TABLE_BOOKS_PATH)!) as Record<string, unknown>;
    expect(written).toMatchObject({ format: 1, books: { A: { notes: [{ id: noteId(1) }] } } });
    expect(written).not.toHaveProperty('id');
    expect(written).not.toHaveProperty('campaignId');
    expect(books.of('A')?.notes).toHaveLength(1);
    expect(books.of('B')).toBeUndefined();
  });

  it('cannot be changed before the worlds\' books were carried into it', async () => {
    const vault = createInMemoryApp({ files: { [`${FOLDER}/campaign.json`]: campaignText } });
    opened.push(vault);
    await CampaignFiles.open(vault.app).load();
    const books = TableBooks.open(vault.app);
    expect(books.canChange()).toBe(false);
    expect(books.change((stored) => withBook(stored, 'A', bookWith(1)))).toBe(false);
    await books.whenReady();
    expect(books.canChange()).toBe(true);
  });

  it('changing A keeps a book another device wrote for B meanwhile', async () => {
    const { vault, books } = await device();
    books.change((stored) => withBook(stored, 'A', bookWith(1)));
    await books.flush();
    // Another device's copy arrives on disk before this device writes again.
    const onDisk = JSON.parse(vault.files.get(TABLE_BOOKS_PATH)!) as { books: Record<string, unknown> };
    onDisk.books.B = bookWith(2);
    vault.files.set(TABLE_BOOKS_PATH, `${JSON.stringify(onDisk)}\n`);
    books.change((stored) => withBook(stored, 'A', bookWith(3)));
    await books.flush();
    const written = JSON.parse(vault.files.get(TABLE_BOOKS_PATH)!) as { books: Record<string, { notes: { id: string }[] }> };
    expect(written.books.A?.notes.map((note) => note.id)).toEqual([noteId(3)]);
    expect(written.books.B?.notes.map((note) => note.id)).toEqual([noteId(2)]);
    await settle();
  });
});
