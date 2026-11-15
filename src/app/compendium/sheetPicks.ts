/**
 * The compendium as a character sheet in Obsidian reaches it: the entries of the world played (else
 * of every installed book of the sheet's game system) to pick from, finding an entry by name to read,
 * and taking one into a sheet's note and into the character's book.
 */

import type { App, TFile } from 'obsidian';
import { CampaignFiles } from '../campaigns/CampaignFiles';
import { CampaignPlay } from '../campaigns/campaignPlay';
import type { StoredCampaign } from '../campaigns/campaignTypes';
import { frontmatterSource } from '../statblocks/notes/statblockSource';
import { FIVE_E_2014_CHARACTER_ID, FIVE_E_2024_CHARACTER_ID } from '../statblocks/presets/fiveECharacter';
import type { CompendiumChoice, PickKind } from './pickKinds';
import { CompendiumService } from './CompendiumService';
import { booksOf, compendiumEntries, type CompendiumBook, type CompendiumEntry } from './compendiumEntries';
import { choiceDetail, gearKind, linkText } from './sheetPickEdits';
import { ENTRY_KIND_KEY, type EntryKind } from './sourceFormat';

type Frontmatter = Readonly<Record<string, unknown>>;

/** The kind of compendium entry each pick reads. */
const ENTRY_OF: Readonly<Record<PickKind, EntryKind>> = {
  class: 'class', subclass: 'subclass', species: 'species', background: 'background', spell: 'spell', weapon: 'item', armor: 'item',
};

const frontmatterOf = (app: App, path: string): Frontmatter => {
  const file = app.vault.getFileByPath(path);
  return (file === null ? undefined : app.metadataCache.getFileCache(file)?.frontmatter) ?? {};
};

/** The game system of the books each character template follows, by template id. */
const CHARACTER_SYSTEMS: Readonly<Record<string, string>> = {
  [FIVE_E_2014_CHARACTER_ID]: 'dnd5e-2014',
  [FIVE_E_2024_CHARACTER_ID]: 'dnd5e-2024',
};

/** The game system a character sheet's note follows; null for a note that is no character sheet. */
function sheetSystem(sheet: Frontmatter | null): string | null {
  const source = frontmatterSource(sheet);
  return source?.kind === 'atlas' && Object.hasOwn(CHARACTER_SYSTEMS, source.templateId) ? CHARACTER_SYSTEMS[source.templateId] ?? null : null;
}

/** The classes a character note lists, by name: a subclass is picked among theirs. */
export function classNamesOf(note: Frontmatter | null | undefined): string[] {
  const classes = note?.classes;
  if (!Array.isArray(classes)) return [];
  return classes.map((entry: unknown) => (typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string' ? entry.name : '')).filter((name) => name !== '');
}

/** The world whose compendium a sheet reads: the one played on this device; null while none is. */
function sheetCampaign(app: App): StoredCampaign | null {
  const playing = CampaignPlay.forApp(app).playing();
  return playing === null ? null : CampaignFiles.forApp(app)?.entries().find((campaign) => campaign.id === playing) ?? null;
}

/**
 * The books a sheet picks from: the played world's, or where none is played or it names none, every
 * installed book of the sheet's game system (of every system for a note that is no character sheet).
 */
export async function sheetBooks(app: App, sheet: Frontmatter | null = null): Promise<CompendiumBook[]> {
  const installed = await CompendiumService.forApp(app).installed();
  const sources = sheetCampaign(app)?.sources;
  const ids = Array.isArray(sources) && sources.length > 0 ? sources.filter((id): id is string => typeof id === 'string') : null;
  if (ids !== null) return booksOf(installed, ids);
  const system = sheetSystem(sheet);
  return booksOf(installed, null).filter((book) => system === null || book.systemId === system);
}

/** The entries of a kind in `books`, a weapon or an armour among the items by what it is. */
export function entriesOfKind(app: App, books: readonly CompendiumBook[], kind: PickKind, chosenClasses: readonly string[] = []): CompendiumEntry[] {
  const notes = app.vault.getMarkdownFiles().map((file) => ({ path: file.path, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter }));
  return compendiumEntries(books, notes).filter((entry) => {
    if (entry.group !== ENTRY_OF[kind]) return false;
    if (kind === 'weapon' || kind === 'armor') return gearKind(frontmatterOf(app, entry.path)) === kind;
    // A subclass of a class the character has, where it has some.
    if (kind === 'subclass' && chosenClasses.length > 0) {
      const named = frontmatterOf(app, entry.path).class;
      const of = linkText(typeof named === 'string' ? named : '').toLowerCase();
      return of === '' || chosenClasses.some((name) => name.toLowerCase() === of);
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The entries offered for a kind to the sheet whose note's frontmatter is `sheet`, by vault path. */
export async function sheetChoices(app: App, kind: PickKind, sheet: Frontmatter | null): Promise<CompendiumChoice[]> {
  const books = await sheetBooks(app, sheet);
  return entriesOfKind(app, books, kind, classNamesOf(sheet)).map((entry) => {
    const detail = choiceDetail(kind, frontmatterOf(app, entry.path));
    return { id: entry.path, name: entry.name, ...(detail !== '' && { detail }) };
  });
}

/** The note of an entry of that kind and name in the books of the sheet whose note's frontmatter is `sheet`, or null. */
export async function findSheetEntry(app: App, kind: PickKind, name: string, sheet: Frontmatter | null = null): Promise<TFile | null> {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') return null;
  const books = await sheetBooks(app, sheet);
  const entry = entriesOfKind(app, books, kind).find((candidate) => candidate.name.toLowerCase() === wanted);
  // An entry the sheet names that is no weapon by its properties (a custom one) is still found by name.
  const any = entry ?? (kind === 'weapon' || kind === 'armor'
    ? compendiumEntries(books, app.vault.getMarkdownFiles().map((file) => ({ path: file.path, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter })))
      .find((candidate) => candidate.group === 'item' && candidate.name.toLowerCase() === wanted)
    : undefined);
  return any === undefined ? null : app.vault.getFileByPath(any.path);
}

/** Whether a path is an entry of the kind among the books of the sheet whose note's frontmatter is `sheet`: what a pick may take. */
export async function isSheetChoice(app: App, kind: PickKind, path: string, sheet: Frontmatter | null = null): Promise<boolean> {
  return entriesOfKind(app, await sheetBooks(app, sheet), kind).some((entry) => entry.path === path) && frontmatterOf(app, path)[ENTRY_KIND_KEY] !== undefined;
}
