import type { App, TFile } from 'obsidian';
import { activeShelf } from '../online/gm/book/activeShelf.ts';
import { applyBookMessage, shelfMessageOf } from '../online/gm/book/bookStore.ts';
import { parsePlayerBookMessage } from '../online/protocol/index.ts';
import { cardName, splitNote } from '../compendium/entryCard';
import type { PickKind } from '../compendium/pickKinds';
import { pickResult, type BookGear } from '../compendium/sheetPickEdits';
import { NoteFieldWriter } from '../statblocks/notes/NoteFieldWriter';
import { noteName } from '../utils/pathUtils';
import { isCharacterNote, noteFile } from './characterTemplates';
import { bookPlaces } from './SheetBook';

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
  const place = (await bookPlaces(app, file))[0];
  if (place === undefined) return false;
  const id = newId();
  const write = (book: ReturnType<typeof shelf.of>, message: unknown): ReturnType<typeof shelf.of> | null => {
    // The GM's writes take the player's road: the protocol's parser first, as the sheet's Book tab does.
    const parsed = shelfMessageOf(parsePlayerBookMessage(JSON.parse(JSON.stringify(message)) as Record<string, unknown>));
    return parsed === null ? null : applyBookMessage(book, parsed, Date.now(), new Set());
  };
  let book = write(shelf.of(place.key), { t: 'book-item-put', item: { id, ...gear.item } });
  if (book === null) return false;
  const taken = new Set(book.equipped.map((entry) => entry.slot));
  const slot = gear.slot === 'main-hand' && taken.has('main-hand') ? (taken.has('off-hand') ? null : 'off-hand') : taken.has(gear.slot) ? null : gear.slot;
  if (slot !== null) book = write(book, { t: 'book-equip', item: id, slot }) ?? book;
  shelf.keep(place.key, book, 'gm');
  return true;
}

/**
 * Takes the compendium entry at `entryPath` into the character sheet at `sheetPath`: its fields'
 * patches, built against the note as the write finds it, and a weapon's or an armour's item into the book.
 */
export async function applySheetPick(app: App, sheetPath: string, kind: PickKind, entryPath: string): Promise<SheetPickDone> {
  const file = noteFile(app, sheetPath);
  const entry = app.vault.getFileByPath(entryPath);
  if (file === null || entry === null || !isCharacterNote(app, sheetPath)) return { sheet: false, book: null };
  const { frontmatter, body } = splitNote(await app.vault.cachedRead(entry));
  const name = cardName(frontmatter, noteName(entry.path));
  let gear: BookGear | null = null;
  const outcome = await NoteFieldWriter.forApp(app).patchNow(file.path, (note) => {
    const result = pickResult(kind, name, frontmatter, body, note ?? {});
    gear = result.gear;
    return result.patches;
  });
  const book = gear === null ? null : await addGear(app, file, gear);
  return { sheet: outcome.problem === null && outcome.conflicts.length === 0, book };
}
