import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../../src/app/campaigns/campaignPaths';
import { TABLE_BOOKS_PATH } from '../../../../src/app/campaigns/players/tableBooksFile';
import { TableBooks } from '../../../../src/app/campaigns/players/TableBooks';
import { BookShelf } from '../../../../src/app/online/gm/book/BookShelf.ts';
import { BOOK_WRITE_MS, BoundBookSource, tableBookSource } from '../../../../src/app/online/gm/book/tableBookSource.ts';
import { EMPTY_BOOK, type StoredBook } from '../../../../src/app/online/gm/book/bookStore.ts';
import type { Timers } from '../../../../src/app/online/gm/companionTimers.ts';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';

const FOLDER = `${CAMPAIGNS_FOLDER}/Witherwild`;
const PATH = TABLE_BOOKS_PATH;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1 })}\n`;
const id = (count: number): string => count.toString(16).padStart(24, '0');
const bookWith = (count: number): StoredBook => ({ ...EMPTY_BOOK, notes: [{ id: id(count), title: `Note ${count}`, body: 'Body', at: count }] });

/** Timers the test moves on by hand. */
function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (run, ms) => {
      due.set(next, { at: now + ms, run });
      return next++;
    },
    clearTimer: (timer) => void due.delete(timer),
    advance(ms) {
      now += ms;
      for (const [timer, entry] of [...due]) if (entry.at <= now) {
        due.delete(timer);
        entry.run();
      }
    },
  };
}

const opened: ReturnType<typeof createInMemoryApp>[] = [];

async function device(files: Record<string, string> = { [`${FOLDER}/campaign.json`]: campaignText }): Promise<{ vault: ReturnType<typeof createInMemoryApp>; books: TableBooks }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  const books = TableBooks.open(vault.app);
  await books.load();
  return { vault, books };
}

const fileBooks = (vault: ReturnType<typeof createInMemoryApp>): Record<string, { notes: { id: string }[] }> => (JSON.parse(vault.files.get(PATH) ?? '{"books":{}}') as { books: Record<string, { notes: { id: string }[] }> }).books;

afterEach(() => {
  vi.restoreAllMocks();
  for (const vault of opened.splice(0)) {
    TableBooks.release(vault.app);
    CampaignFiles.release(vault.app);
  }
});

describe('the books of the table', () => {
  it('are read back at once and written to the table\'s file BOOK_WRITE_MS after the first change, one write for all of a character\'s changes', async () => {
    const { vault, books } = await device();
    const timers = fakeTimers();
    const shelf = new BookShelf(tableBookSource(books, timers));
    shelf.keep('lib-a', bookWith(1));
    shelf.keep('lib-a', bookWith(2));
    expect(shelf.of('lib-a').notes.map((note) => note.id)).toEqual([id(2)]);
    timers.advance(BOOK_WRITE_MS - 1);
    await books.flush();
    expect(vault.files.has(PATH)).toBe(false);
    timers.advance(1);
    await books.flush();
    expect(fileBooks(vault)['lib-a']?.notes.map((note) => note.id)).toEqual([id(2)]);
  });

  it('write only the changed character\'s entry, so a book another device wrote stays', async () => {
    const { vault, books } = await device({ [`${FOLDER}/campaign.json`]: campaignText, [PATH]: `${JSON.stringify({ format: 1, books: { other: bookWith(9) } })}\n` });
    const timers = fakeTimers();
    const source = tableBookSource(books, timers);
    source.write('lib-a', bookWith(1));
    // The other device's change reaches the disk before this one's write.
    vault.files.set(PATH, `${JSON.stringify({ format: 1, books: { other: bookWith(9), theirs: bookWith(8) } })}\n`);
    timers.advance(BOOK_WRITE_MS);
    await books.flush();
    expect(Object.keys(fileBooks(vault)).sort()).toEqual(['lib-a', 'other', 'theirs']);
  });

  it('are written at once when flushed, as on unload', async () => {
    const { vault, books } = await device();
    const source = tableBookSource(books, fakeTimers());
    source.write('lib-a', bookWith(1));
    source.flush();
    await books.flush();
    expect(Object.keys(fileBooks(vault))).toEqual(['lib-a']);
  });

  it('stay in memory while no table is bound, or its file is of a later format', async () => {
    const later = `${JSON.stringify({ format: 2, books: {} })}\n`;
    const { vault, books } = await device({ [`${FOLDER}/campaign.json`]: campaignText, [PATH]: later });
    const bound = new BoundBookSource();
    const shelf = new BookShelf(bound);
    shelf.keep('lib-a', bookWith(1));
    bound.bind(tableBookSource(books, fakeTimers()));
    shelf.keep('lib-b', bookWith(2));
    bound.flush();
    await books.flush();
    expect(vault.files.get(PATH)).toBe(later);
    expect(shelf.of('lib-a').notes).toHaveLength(1);
    expect(shelf.of('lib-b').notes).toHaveLength(1);
  });
});
