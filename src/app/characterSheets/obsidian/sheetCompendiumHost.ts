import type { App, TFile } from 'obsidian';
import { CompendiumService } from '../../compendium/CompendiumService';
import { OFFICIAL_SOURCES } from '../../compendium/officialSources';
import { findSheetEntry, sheetBooks, sheetChoices } from '../../compendium/sheetPicks';
import { isPersonalBookId } from '../../compendium/sourceTree';
import { showNotice } from '../../ui/notice';
import type { PickKind, SheetCompendium } from '../sheetCompendium.ts';
import type { SheetValues } from '../sheetFields.ts';
import { applySheetPick } from './sheetPick.ts';
import { SHEET_TEXT } from './sheetText.ts';

const ENTRY_KIND = { class: 'class', subclass: 'subclass', species: 'species', background: 'background', spell: 'spell', weapon: 'item', armor: 'item' } as const;

/** The classes a sheet lists, by name: a subclass is picked among theirs. */
export const classNamesOf = (values: SheetValues): string[] => (Array.isArray(values.classes) ? (values.classes as readonly Record<string, unknown>[]).map((row) => (typeof row.name === 'string' ? row.name : '')).filter((name) => name !== '') : []);

/**
 * The compendium as the GM's sheet in Obsidian reaches it: the campaign's entries, an entry opened
 * in a tab, a new one made in the campaign's Personal book, and a pick written into the note and
 * the book. `changing` wraps each write so the sheet does not read its own echo halfway.
 */
export function gmSheetCompendium(app: App, file: TFile, values: () => SheetValues, changing: (write: Promise<unknown>) => void): SheetCompendium {
  const open = (target: TFile): void => {
    app.workspace.getLeaf('tab').openFile(target).catch((error: unknown) => console.error('[sheetCompendium] Opening the entry failed:', error));
  };
  return {
    choices: (kind) => sheetChoices(app, kind, classNamesOf(values())),
    pick: (kind, choice) => {
      changing(applySheetPick(app, file.path, kind, choice.id).then((done) => {
        if (!done.sheet) showNotice(SHEET_TEXT.compendium.notTaken(choice.name));
        else if (done.book === false) showNotice(SHEET_TEXT.compendium.noBook(choice.name));
      }));
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
