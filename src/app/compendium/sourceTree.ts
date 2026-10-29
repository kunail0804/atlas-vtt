import type { InstalledSource } from './installedSources';
import type { OfficialSource } from './officialSources';
import type { SourceLabel } from './sourceFormat';

/** The book id of each system's own book, where the GM's entries go: `dnd5e-2014/personal`. */
export const PERSONAL_BOOK_ID = 'personal';

/** Where a source stands in this vault. */
export type BookState =
  | { kind: 'available'; official: OfficialSource }
  | { kind: 'installed'; version: number }
  | { kind: 'outdated'; version: number; official: OfficialSource };

export interface BookChoice {
  /** The source id. */
  id: string;
  name: string;
  /** Not one of Atlas' sources: the GM's own, made in the compendium or installed from a zip file. */
  personal: boolean;
  state: BookState;
}

export interface SystemChoice {
  id: string;
  name: string;
  books: BookChoice[];
}

/**
 * The source picker's tree: game systems, then their books. Atlas' own sources appear whether or
 * not they are installed; personal sources only once installed. A source a campaign lists but the
 * vault lacks (deleted, or not synced yet) is left out of the tree: it cannot be chosen again here.
 * A system's Personal book (`PERSONAL_BOOK_ID`) is no choice: Atlas makes it for every system a
 * campaign uses (`personalBooksFor`), so it is left out.
 */
export function sourceTree(official: readonly OfficialSource[], installed: readonly InstalledSource[]): SystemChoice[] {
  const systems = new Map<string, SystemChoice>();
  const systemOf = (id: string, name: string): SystemChoice => {
    let system = systems.get(id);
    if (!system) {
      system = { id, name, books: [] };
      systems.set(id, system);
    }
    return system;
  };
  const installedById = new Map(installed.map((source) => [source.manifest.id, source]));

  for (const source of official) {
    const record = installedById.get(source.id);
    let state: BookState = { kind: 'available', official: source };
    if (record) {
      const version = record.manifest.version;
      state = version < source.version ? { kind: 'outdated', version, official: source } : { kind: 'installed', version };
    }
    systemOf(source.system.id, source.system.name).books.push({ id: source.id, name: source.book.name, personal: false, state });
  }
  for (const record of installed) {
    if (official.some((source) => source.id === record.manifest.id)) continue;
    const { system, book, version } = record.manifest;
    if (book.id === PERSONAL_BOOK_ID) continue;
    systemOf(system.id, system.name).books.push({ id: record.manifest.id, name: book.name, personal: true, state: { kind: 'installed', version } });
  }

  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  return [...systems.values()]
    .map((system) => ({ ...system, books: [...system.books].sort(byName) }))
    .sort(byName);
}

/** Whether every book of the system is chosen, some are, or none. */
export function systemSelection(system: SystemChoice, chosen: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const count = system.books.filter((book) => chosen.has(book.id)).length;
  if (count === 0) return 'none';
  return count === system.books.length ? 'all' : 'some';
}

/** The choice after the GM ticks or unticks a whole system: all of its books, or none. */
export function toggleSystem(system: SystemChoice, chosen: ReadonlySet<string>): Set<string> {
  const next = new Set(chosen);
  const selectAll = systemSelection(system, chosen) !== 'all';
  for (const book of system.books) {
    if (selectAll) next.add(book.id);
    else next.delete(book.id);
  }
  return next;
}

/** Whether a source id is a system's Personal book. */
export const isPersonalBookId = (id: string): boolean => id.endsWith(`/${PERSONAL_BOOK_ID}`);

/** The choice after the GM ticks or unticks one book. */
export function toggleBook(id: string, chosen: ReadonlySet<string>): Set<string> {
  const next = new Set(chosen);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The systems whose Personal book a campaign uses: every system it has a book of. */
export function personalBooksFor(tree: readonly SystemChoice[], chosen: ReadonlySet<string>): SourceLabel[] {
  return tree.filter((system) => system.books.some((book) => chosen.has(book.id))).map(({ id, name }) => ({ id, name }));
}

/** The chosen books the vault must download first: not installed, or older than Atlas' version. */
export function downloadsFor(tree: readonly SystemChoice[], chosen: ReadonlySet<string>): OfficialSource[] {
  const downloads: OfficialSource[] = [];
  for (const book of tree.flatMap((system) => system.books)) {
    if (!chosen.has(book.id)) continue;
    if (book.state.kind === 'available' || book.state.kind === 'outdated') downloads.push(book.state.official);
  }
  return downloads;
}
