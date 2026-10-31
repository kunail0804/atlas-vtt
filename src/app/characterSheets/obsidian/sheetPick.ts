import type { App, TFile } from 'obsidian';
import { activeShelf } from '../../online/gm/book/activeShelf.ts';
import { applyBookMessage } from '../../online/gm/book/bookStore.ts';
import { parsePlayerBookMessage } from '../../online/protocol/index.ts';
import { cardName, splitNote } from '../../compendium/entryCard';
import { pickResult, type BookGear } from '../../compendium/sheetPickEdits';
import type { PickKind } from '../sheetCompendium.ts';
import { noteName } from '../../utils/pathUtils';
import { editSheetFile, readSheetFile, sheetFile } from './sheetFiles.ts';
import { bookPlaces } from './SheetBook.tsx';

/** What taking an entry did: whether the sheet took it, and whether its item went into the book (null: it has none). */
export interface SheetPickDone {
  readonly sheet: boolean;
  readonly book: boolean | null;
}

const newId = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Puts a weapon or an armour into the character's book and into the slot it is worn in, where that
 * slot is free (a second weapon takes the off hand). False where no book is kept: online play off,
 * or no token is linked to the sheet.
 */
async function addGear(app: App, file: TFile, gear: BookGear): Promise<boolean> {
  const shelf = activeShelf();
  if (shelf === null) return false;
  const place = (await bookPlaces(app, file, shelf))[0];
  if (place === undefined) return false;
  const id = newId();
  const write = (book: ReturnType<typeof shelf.of>, message: unknown): ReturnType<typeof shelf.of> | null => {
    // The GM's writes take the player's road: the protocol's parser first, as the sheet's Book tab does.
    const parsed = parsePlayerBookMessage(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
    return parsed === null || parsed.t === 'book-resource' ? null : applyBookMessage(book, parsed, Date.now(), new Set());
  };
  let book = write(shelf.of(place.collection, place.key), { t: 'book-item-put', item: { id, ...gear.item } });
  if (book === null) return false;
  const taken = new Set(book.equipped.map((entry) => entry.slot));
  const slot = gear.slot === 'main-hand' && taken.has('main-hand') ? (taken.has('off-hand') ? null : 'off-hand') : taken.has(gear.slot) ? null : gear.slot;
  if (slot !== null) book = write(book, { t: 'book-equip', item: id, slot }) ?? book;
  shelf.keep(place.collection, place.key, book, 'gm');
  return true;
}

/**
 * Takes the compendium entry at `entryPath` into the character sheet at `sheetPath`: its edits by the
 * sheet's own rules, and a weapon's or an armour's item into the book.
 */
export async function applySheetPick(app: App, sheetPath: string, kind: PickKind, entryPath: string): Promise<SheetPickDone> {
  const file = sheetFile(app, sheetPath);
  const entry = app.vault.getFileByPath(entryPath);
  const sheet = file === null ? null : await readSheetFile(app, file);
  if (file === null || entry === null || sheet === null) return { sheet: false, book: null };
  const { frontmatter, body } = splitNote(await app.vault.cachedRead(entry));
  const result = pickResult(kind, cardName(frontmatter, noteName(entry.path)), frontmatter, body, sheet.values);
  let written = true;
  for (const edit of result.edits) written = (await editSheetFile(app, file, edit)) !== null && written;
  const book = result.gear === null ? null : await addGear(app, file, result.gear);
  return { sheet: written, book };
}
