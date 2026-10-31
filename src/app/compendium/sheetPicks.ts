/**
 * The compendium as a character sheet in Obsidian reaches it: the entries of the campaign played
 * (else of the most recently played one, else of every installed book) to pick from, finding an
 * entry by name to read, and taking one into a sheet's note and into the character's book.
 */

import type { App, TFile } from 'obsidian';
import { CampaignFiles } from '../campaigns/CampaignFiles';
import { CampaignPlay } from '../campaigns/campaignPlay';
import type { StoredCampaign } from '../campaigns/campaignTypes';
import type { CompendiumChoice, PickKind } from '../characterSheets/sheetCompendium';
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

/** The campaign whose compendium a sheet reads: the one played on this device, else the one played last. */
function sheetCampaign(app: App): StoredCampaign | null {
  const campaigns = CampaignFiles.forApp(app)?.entries() ?? [];
  const playing = CampaignPlay.forApp(app).playing();
  const played = campaigns.find((campaign) => campaign.id === playing);
  if (played) return played;
  const last = (campaign: StoredCampaign): number => (typeof campaign.lastPlayed === 'number' ? campaign.lastPlayed : 0);
  return [...campaigns].sort((a, b) => last(b) - last(a))[0] ?? null;
}

/** The books a sheet picks from: the campaign's, or every installed book where it names none. */
export async function sheetBooks(app: App): Promise<CompendiumBook[]> {
  const installed = await CompendiumService.forApp(app).installed();
  const sources = sheetCampaign(app)?.sources;
  const ids = Array.isArray(sources) && sources.length > 0 ? sources.filter((id): id is string => typeof id === 'string') : null;
  return booksOf(installed, ids);
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

/** The entries offered for a kind, by vault path. */
export async function sheetChoices(app: App, kind: PickKind, chosenClasses: readonly string[] = []): Promise<CompendiumChoice[]> {
  const books = await sheetBooks(app);
  return entriesOfKind(app, books, kind, chosenClasses).map((entry) => {
    const detail = choiceDetail(kind, frontmatterOf(app, entry.path));
    return { id: entry.path, name: entry.name, ...(detail !== '' && { detail }) };
  });
}

/** The note of an entry of that kind and name in the sheet's books, or null. */
export async function findSheetEntry(app: App, kind: PickKind, name: string): Promise<TFile | null> {
  const wanted = name.trim().toLowerCase();
  if (wanted === '') return null;
  const entry = entriesOfKind(app, await sheetBooks(app), kind).find((candidate) => candidate.name.toLowerCase() === wanted);
  // An entry the sheet names that is no weapon by its properties (a custom one) is still found by name.
  const any = entry ?? (kind === 'weapon' || kind === 'armor'
    ? compendiumEntries(await sheetBooks(app), app.vault.getMarkdownFiles().map((file) => ({ path: file.path, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter })))
      .find((candidate) => candidate.group === 'item' && candidate.name.toLowerCase() === wanted)
    : undefined);
  return any === undefined ? null : app.vault.getFileByPath(any.path);
}

/** Whether a path is an entry of the kind among the sheet's books: what a pick may take. */
export async function isSheetChoice(app: App, kind: PickKind, path: string): Promise<boolean> {
  return entriesOfKind(app, await sheetBooks(app), kind).some((entry) => entry.path === path) && frontmatterOf(app, path)[ENTRY_KIND_KEY] !== undefined;
}
