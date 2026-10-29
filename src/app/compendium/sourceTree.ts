import type { InstalledSource } from './installedSources';
import type { OfficialSource } from './officialSources';
import type { SourceLabel } from './sourceFormat';

/** The book id of each system's own book, where the GM's entries go: `dnd5e-2014/personal`. */
export const PERSONAL_BOOK_ID = 'personal';

/** Where a source stands in this vault. */
export type BookState =
  | { kind: 'available'; official: OfficialSource }
  | { kind: 'installed'; version: number }
  | { kind: 'outdated'; version: number; official: OfficialSource }
  /** The system's personal book, which saving makes. */
  | { kind: 'new'; system: SourceLabel; book: SourceLabel };

export interface BookChoice {
  /** The source id. */
  id: string;
  name: string;
  /** Not one of Atlas' sources: the GM's own, made here or installed from a zip file. */
  personal: boolean;
  /** The system's personal book (`PERSONAL_BOOK_ID`), ticked with the first book of its system. */
  ownBook?: true;
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
 * Every system has a personal book named `personalName`, made once it is chosen: the GM's own
 * entries go there, and the books Atlas publishes stay as published.
 */
export function sourceTree(official: readonly OfficialSource[], installed: readonly InstalledSource[], personalName = 'Personal'): SystemChoice[] {
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
    const own = book.id === PERSONAL_BOOK_ID ? { ownBook: true as const } : {};
    systemOf(system.id, system.name).books.push({ id: record.manifest.id, name: book.name, personal: true, ...own, state: { kind: 'installed', version } });
  }
  for (const system of systems.values()) {
    const id = `${system.id}/${PERSONAL_BOOK_ID}`;
    if (system.books.some((book) => book.id === id)) continue;
    const label = { id: system.id, name: system.name };
    system.books.push({ id, name: personalName, personal: true, ownBook: true, state: { kind: 'new', system: label, book: { id: PERSONAL_BOOK_ID, name: personalName } } });
  }

  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  // The personal book comes after the system's other books.
  const byBook = (a: BookChoice, b: BookChoice): number => Number(a.ownBook === true) - Number(b.ownBook === true) || byName(a, b);
  return [...systems.values()]
    .map((system) => ({ ...system, books: [...system.books].sort(byBook) }))
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

/**
 * The choice after the GM ticks or unticks one book. Ticking the first book of a system ticks
 * its personal book too; the GM may untick it afterwards.
 */
export function toggleBook(system: SystemChoice, id: string, chosen: ReadonlySet<string>): Set<string> {
  const next = new Set(chosen);
  if (next.delete(id)) return next;
  const own = system.books.find((book) => book.ownBook === true);
  if (own !== undefined && own.id !== id && systemSelection(system, chosen) === 'none') next.add(own.id);
  next.add(id);
  return next;
}

/** The chosen personal books the vault must make first. */
export function booksToMake(tree: readonly SystemChoice[], chosen: ReadonlySet<string>): Array<{ system: SourceLabel; book: SourceLabel }> {
  const made: Array<{ system: SourceLabel; book: SourceLabel }> = [];
  for (const book of tree.flatMap((system) => system.books)) {
    if (chosen.has(book.id) && book.state.kind === 'new') made.push({ system: book.state.system, book: book.state.book });
  }
  return made;
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
