import { afterEach, describe, expect, it } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import type { StoredBooks } from '../../../src/app/campaigns/players/booksFile';
import { mergeWorldBooks } from '../../../src/app/campaigns/players/booksMigration';
import { CampaignPlayers } from '../../../src/app/campaigns/players/CampaignPlayers';
import { TABLE_BOOKS_PATH } from '../../../src/app/campaigns/players/tableBooksFile';
import { TableBooks } from '../../../src/app/campaigns/players/TableBooks';
import { TablePlayers } from '../../../src/app/campaigns/players/TablePlayers';
import { EMPTY_BOOK, type StoredBook } from '../../../src/app/online/gm/book/bookStore';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const noteId = (count: number): string => count.toString(16).padStart(24, '0');
const note = (count: number): StoredBook['notes'][number] => ({ id: noteId(count), title: `Note ${count}`, body: 'Body', at: count });
const pin = (count: number): StoredBook['pins'][number] => ({ id: noteId(100 + count), x: 0.5, y: 0.5, kind: 'note', title: `Pin ${count}`, body: '' });
const bookWith = (...counts: number[]): StoredBook => ({ ...EMPTY_BOOK, notes: counts.map(note) });
const world = (id: string, books: Record<string, unknown>, lastPlayed: number): { stored: StoredBooks; lastPlayed: number } => ({ stored: { id, campaignId: id, format: 1, books }, lastPlayed });
const ids = (book: unknown): string[] => ((book as StoredBook).notes ?? []).map((entry) => entry.id);

const MIRA_W = 'a'.repeat(20);
const MIRA_M = 'm'.repeat(20);

describe('merging the worlds\' books', () => {
  it('gives a character the whole book of the world played last, fields Atlas does not know included', () => {
    const recent = { ...bookWith(2), future: 'kept' };
    const merged = mergeWorldBooks([world('c2', { tok1: bookWith(1), tok2: bookWith(5) }, 100), world('c1', { tok1: recent }, 200)], {});
    expect(merged?.books).toEqual({ tok1: recent, tok2: bookWith(5) });
    expect(merged).not.toHaveProperty('campaignId');
  });

  it('ranks worlds played at the same time by their id', () => {
    const merged = mergeWorldBooks([world('c2', { tok1: bookWith(2) }, 100), world('c1', { tok1: bookWith(1) }, 100)], {});
    expect(ids(merged?.books.tok1)).toEqual([noteId(1)]);
  });

  it('carries a player\'s own book to their id at the table, uniting the notes and pins of books that become one', () => {
    const fromW = { ...bookWith(1, 3), pins: [pin(1)] };
    const fromM = { ...bookWith(2, 3), pins: [pin(2)] };
    const merged = mergeWorldBooks(
      [world('c1', { [`player:${MIRA_W}`]: fromW }, 200), world('c2', { [`player:${MIRA_M}`]: fromM }, 100)],
      { c1: { [MIRA_W]: MIRA_W }, c2: { [MIRA_M]: MIRA_W } },
    );
    expect(Object.keys(merged?.books ?? {})).toEqual([`player:${MIRA_W}`]);
    const united = merged?.books[`player:${MIRA_W}`] as StoredBook;
    expect(united.notes.map((entry) => entry.id).sort()).toEqual([noteId(1), noteId(2), noteId(3)]);
    expect(united.pins.map((entry) => entry.id).sort()).toEqual([noteId(101), noteId(102)]);
  });

  it('keeps a player\'s own book under its id where the table\'s players file names no other', () => {
    const merged = mergeWorldBooks([world('c1', { [`player:${MIRA_M}`]: bookWith(1) }, 0)], {});
    expect(Object.keys(merged?.books ?? {})).toEqual([`player:${MIRA_M}`]);
  });

  it('is the same whatever order the worlds come in, and nothing where no world has a book', () => {
    const a = world('c1', { tok1: bookWith(1), [`player:${MIRA_W}`]: bookWith(4) }, 200);
    const b = world('c2', { tok1: bookWith(2), tok2: bookWith(3), [`player:${MIRA_M}`]: bookWith(5) }, 100);
    const renamed = { c2: { [MIRA_M]: MIRA_W } };
    expect(JSON.stringify(mergeWorldBooks([a, b], renamed))).toBe(JSON.stringify(mergeWorldBooks([b, a], renamed)));
    expect(mergeWorldBooks([world('c1', { tok1: EMPTY_BOOK, broken: 'no book' }, 0)], {})).toBeNull();
    expect(mergeWorldBooks([], {})).toBeNull();
  });
});

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;
const campaignText = (id: string, name: string, lastPlayed: number): string => `${JSON.stringify({ format: 1, id, name, createdAt: 1, lastPlayed })}\n`;
const playersText = (campaignId: string, id: string, name: string, code: string, addedAt: number): string =>
  `${JSON.stringify({ format: 1, campaignId, players: { [id]: { name, code, characters: [], addedAt } } }, null, 2)}\n`;
const booksText = (campaignId: string, books: Record<string, unknown>): string => `${JSON.stringify({ format: 1, campaignId, books }, null, 2)}\n`;

/** Mira in both worlds under two ids (added first in the Moor), each world with a book of tok1, the Witherwild played last. */
const WORLDS: Record<string, string> = {
  [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild', 200),
  [`${MOOR}/campaign.json`]: campaignText('c2', 'Moor', 100),
  [`${WITHERWILD}/players.json`]: playersText('c1', MIRA_W, 'Mira', '123456', 20),
  [`${MOOR}/players.json`]: playersText('c2', MIRA_M, 'mira', '654321', 10),
  [`${WITHERWILD}/books.json`]: booksText('c1', { tok1: bookWith(1), [`player:${MIRA_W}`]: bookWith(7) }),
  [`${MOOR}/books.json`]: booksText('c2', { tok1: bookWith(2), [`player:${MIRA_M}`]: bookWith(8) }),
};

const opened: ReturnType<typeof createInMemoryApp>[] = [];

/** A device as the plugin starts it: campaigns, the worlds' players, the table's players, then the table's books. */
async function device(files: Record<string, string>): Promise<{ vault: ReturnType<typeof createInMemoryApp>; books: TableBooks }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  await CampaignPlayers.open(vault.app).whenLoaded();
  await TablePlayers.open(vault.app).whenReady();
  const books = TableBooks.open(vault.app);
  await books.whenReady();
  await books.flush();
  return { vault, books };
}

afterEach(() => {
  for (const vault of opened.splice(0)) {
    TableBooks.release(vault.app);
    TablePlayers.release(vault.app);
    CampaignPlayers.release(vault.app);
    CampaignFiles.release(vault.app);
  }
});

describe('carrying the worlds\' books into the table\'s books file', () => {
  it('writes the file once, with the merged players\' ids, and leaves the worlds\' files as they were', async () => {
    const { vault, books } = await device(WORLDS);
    // Mira keeps the id she had in the Moor, where she was added first.
    expect(ids(books.of('tok1'))).toEqual([noteId(1)]);
    expect(ids(books.of(`player:${MIRA_M}`)).sort()).toEqual([noteId(7), noteId(8)]);
    expect(books.of(`player:${MIRA_W}`)).toBeUndefined();
    for (const [path, text] of Object.entries(WORLDS)) expect(vault.files.get(path)).toBe(text);
    expect(JSON.parse(vault.files.get(TABLE_BOOKS_PATH)!)).toMatchObject({ format: 1 });
  });

  it('writes the same file on two devices that migrate at once', async () => {
    const one = await device(WORLDS);
    const two = await device(WORLDS);
    expect(one.vault.files.get(TABLE_BOOKS_PATH)).toBeDefined();
    expect(two.vault.files.get(TABLE_BOOKS_PATH)).toBe(one.vault.files.get(TABLE_BOOKS_PATH));
  });

  it('leaves a file the vault has alone, even one that cannot be read, and writes none where no world has books', async () => {
    const held = `${JSON.stringify({ format: 1, books: { tok9: bookWith(9) } })}\n`;
    const kept = await device({ ...WORLDS, [TABLE_BOOKS_PATH]: held });
    expect(kept.vault.files.get(TABLE_BOOKS_PATH)).toBe(held);
    expect(kept.books.of('tok1')).toBeUndefined();

    const broken = await device({ ...WORLDS, [TABLE_BOOKS_PATH]: '{ not json' });
    expect(broken.vault.files.get(TABLE_BOOKS_PATH)).toBe('{ not json');

    const none = await device({ [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild', 1) });
    expect(none.vault.files.has(TABLE_BOOKS_PATH)).toBe(false);
  });
});
