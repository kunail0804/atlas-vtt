import type { App, TFile } from 'obsidian';
import { CompendiumService } from '../compendium/CompendiumService';
import { OFFICIAL_SOURCES } from '../compendium/officialSources';
import type { PickKind, SheetCompendium } from '../compendium/pickKinds';
import { findSheetEntry, sheetBooks, sheetChoices } from '../compendium/sheetPicks';
import { isPersonalBookId } from '../compendium/sourceTree';
import { showNotice } from '../ui/notice';
import { applySheetPick } from './sheetPick';
import { SHEET_TEXT } from './sheetText';

const ENTRY_KIND = { class: 'class', subclass: 'subclass', species: 'species', background: 'background', spell: 'spell', weapon: 'item', armor: 'item' } as const;

/** The classes a character note lists, by name: a subclass is picked among theirs. */
export function classNamesOf(note: Readonly<Record<string, unknown>> | undefined): string[] {
  const classes = note?.classes;
  if (!Array.isArray(classes)) return [];
  return classes.map((entry: unknown) => (typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string' ? entry.name : '')).filter((name) => name !== '');
}

/**
 * The compendium as the GM's sheet in Obsidian reaches it: the campaign's entries, an entry opened
 * in a tab, a new one made in the campaign's Personal book, and a pick written into the note and
 * the book.
 */
export function gmSheetCompendium(app: App, file: TFile): SheetCompendium {
  const open = (target: TFile): void => {
    app.workspace.getLeaf('tab').openFile(target).catch((error: unknown) => console.error('[sheetCompendium] Opening the entry failed:', error));
  };
  return {
    choices: (kind) => sheetChoices(app, kind, classNamesOf(app.metadataCache.getFileCache(file)?.frontmatter)),
    pick: (kind, choice) => {
      applySheetPick(app, file.path, kind, choice.id).then((done) => {
        if (!done.sheet) showNotice(SHEET_TEXT.compendium.notTaken(choice.name));
        else if (done.book === false) showNotice(SHEET_TEXT.compendium.noBook(choice.name));
      }, (error: unknown) => console.error('[sheetCompendium] Taking the entry failed:', error));
    },
    view: (kind, name) => {
      void findSheetEntry(app, kind, name).then((target) => {
        if (target === null) showNotice(SHEET_TEXT.compendium.notFound(name));
        else open(target);
      });
    },
    create: (kind: PickKind, name: string) => {
      void (async () => {
        const books = await sheetBooks(app);
        const book = books.find((candidate) => isPersonalBookId(candidate.id)) ?? books.find((candidate) => !OFFICIAL_SOURCES.some((source) => source.id === candidate.id));
        if (book === undefined) return showNotice(SHEET_TEXT.compendium.noOwnBook);
        const created = await CompendiumService.forApp(app).createEntry(book, ENTRY_KIND[kind], name === '' ? SHEET_TEXT.compendium.newName[kind] : name);
        // A weapon or an armour is found among the items by what it is.
        if (kind === 'weapon' || kind === 'armor') {
          await app.fileManager.processFrontMatter(created, (frontmatter: Record<string, unknown>) => { frontmatter['item-type'] = kind; });
        }
        open(created);
      })().catch((error: unknown) => {
        console.error('[sheetCompendium] Making the entry failed:', error);
        showNotice(SHEET_TEXT.compendium.createFailed);
      });
    },
  };
}
