/**
 * The notes of a campaign's compendium, as the compendium browser lists them: which book each
 * note belongs to, what kind of entry it is, and the text of a new entry.
 */

import { stringifyYaml } from 'obsidian';
import type { InstalledSource } from './installedSources';
import {
  ENTRY_FOLDERS, ENTRY_KIND_KEY, ENTRY_SOURCE_KEY, ENTRY_SYSTEM_KEY, isEntryKind, isPathInside, type EntryKind,
} from './sourceFormat';

/** A note's kind, or `other` for a note that names none (such as a book's attribution). */
export type EntryGroup = EntryKind | 'other';

/** One installed book, as the browser shows it. */
export interface CompendiumBook {
  /** The source id. */
  id: string;
  systemId: string;
  systemName: string;
  name: string;
  /** The vault folder of its notes. */
  root: string;
}

export interface CompendiumEntry {
  path: string;
  name: string;
  group: EntryGroup;
  /** The id of the book the note is in. */
  bookId: string;
}

/** A Markdown note of the vault and its frontmatter, as the metadata cache has it. */
export interface NoteFacts {
  path: string;
  frontmatter: Readonly<Record<string, unknown>> | undefined;
}

export interface EntryFilter {
  /** Null for every kind. */
  group: EntryGroup | null;
  /** Null for every book. */
  bookId: string | null;
  search: string;
}

export function bookOf(source: InstalledSource): CompendiumBook {
  const { id, system, book, root } = source.manifest;
  return { id, systemId: system.id, systemName: system.name, name: book.name, root };
}

/** The books of `ids` the vault has installed, in the order of `installed`; every installed book when `ids` is null. */
export function booksOf(installed: readonly InstalledSource[], ids: readonly string[] | null): CompendiumBook[] {
  const chosen = ids === null ? null : new Set(ids);
  return installed.filter((source) => chosen === null || chosen.has(source.manifest.id)).map(bookOf);
}

function nameOf(note: NoteFacts): string {
  const name = note.frontmatter?.name;
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  const file = note.path.split('/').pop() ?? note.path;
  return file.replace(/\.md$/i, '');
}

/** Every note inside one of the books' folders, sorted by name. */
export function compendiumEntries(books: readonly CompendiumBook[], notes: readonly NoteFacts[]): CompendiumEntry[] {
  const entries: CompendiumEntry[] = [];
  for (const note of notes) {
    const book = books.find((candidate) => isPathInside(note.path, candidate.root));
    if (!book) continue;
    const kind = note.frontmatter?.[ENTRY_KIND_KEY];
    entries.push({ path: note.path, name: nameOf(note), group: isEntryKind(kind) ? kind : 'other', bookId: book.id });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/** Whether the entry passes the filter. The search matches any part of the name, in any letter case. */
export function entryMatches(entry: CompendiumEntry, filter: EntryFilter): boolean {
  if (filter.group !== null && entry.group !== filter.group) return false;
  if (filter.bookId !== null && entry.bookId !== filter.bookId) return false;
  const search = filter.search.trim().toLowerCase();
  return search === '' || entry.name.toLowerCase().includes(search);
}

/** How many entries each kind has, after the book filter and the search but not the kind filter. */
export function groupCounts(entries: readonly CompendiumEntry[], filter: EntryFilter): Map<EntryGroup, number> {
  const counts = new Map<EntryGroup, number>();
  for (const entry of entries) {
    if (!entryMatches(entry, { ...filter, group: null })) continue;
    counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
  }
  return counts;
}

/** The folder of a book that a new entry of `kind` goes in. */
export function entryFolder(book: CompendiumBook, kind: EntryKind): string {
  return `${book.root}/${ENTRY_FOLDERS[kind]}`;
}

/** The properties a new entry starts with: its kind, its system, its book and its name. */
export function entryProperties(book: CompendiumBook, kind: EntryKind, name: string): Record<string, string> {
  return { [ENTRY_KIND_KEY]: kind, [ENTRY_SYSTEM_KEY]: book.systemId, [ENTRY_SOURCE_KEY]: book.id, name };
}

/** The text of a new entry that is not a statblock: its properties, then an empty body. */
export function newEntryText(book: CompendiumBook, kind: EntryKind, name: string): string {
  return `---\n${stringifyYaml(entryProperties(book, kind, name))}---\n`;
}
