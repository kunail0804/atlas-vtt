import { bookLine, bookText, playerFrameBytes } from './bookText.ts';
import { MAX_PLAYER_FRAME } from './relay.ts';
import { isRecord } from './shape.ts';

/**
 * The compendium pages the GM shares with a player, and the player's own device key, which tells
 * the GM who they are from one table to the next.
 *
 * GM to one player: `compendium`, the pages shared with them (sent again whenever that changes);
 * `compendium-entry`, one page whole, once they open it and again when it changes; and
 * `compendium-saved`, how their change of a page went. Player to GM: `identify` after every
 * welcome, `compendium-open` and `compendium-edit`, a change in parts, since a player's frame is
 * small.
 */

export type CompendiumAccess = 'read' | 'write';

/** A shared page in the player's list: an id of its own (never its vault path), its title and kind. */
export interface SharedPage {
  readonly id: string;
  readonly title: string;
  /** The kind of entry: `spell`, `monster`, … or `other`. */
  readonly kind: string;
  readonly access: CompendiumAccess;
}

/** One line of a page's card: "Casting Time: 1 action". */
export interface PageRow {
  readonly label: string;
  readonly value: string;
}

/** A part of a statblock made of named entries: a monster's Actions. */
export interface PageSection {
  readonly heading: string;
  readonly entries: readonly { readonly name: string; readonly text: string }[];
}

/** A property the player may change, with its value as text. */
export interface PageField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** A page whole, as the player reads it. `fields` only where the player may change it. */
export interface SharedPageContent extends SharedPage {
  readonly rows: readonly PageRow[];
  readonly sections: readonly PageSection[];
  /** The note's text, Markdown as written. */
  readonly text: string;
  readonly fields?: readonly PageField[];
}

/** A player's change of a page: the properties they changed, and the page's whole text. */
export interface PageEdit {
  readonly fields: Readonly<Record<string, string>>;
  readonly text: string;
}

export type CompendiumMessage =
  | { readonly t: 'compendium'; readonly pages: readonly SharedPage[] }
  | { readonly t: 'compendium-entry'; readonly page: SharedPageContent }
  | { readonly t: 'compendium-saved'; readonly id: string; readonly ok: boolean };

export type PlayerCompendiumMessage =
  | { readonly t: 'identify'; readonly key: string }
  | { readonly t: 'compendium-open'; readonly id: string }
  | { readonly t: 'compendium-edit'; readonly id: string; readonly edit: string; readonly index: number; readonly count: number; readonly data: string };

export const MAX_SHARED_PAGES = 500;
export const MAX_PAGE_ROWS = 100;
export const MAX_PAGE_SECTIONS = 20;
export const MAX_SECTION_ENTRIES = 100;
export const MAX_PAGE_FIELDS = 100;
export const MAX_PAGE_TITLE = 120;
export const MAX_ROW_VALUE = 2_000;
export const MAX_PAGE_TEXT = 200_000;
/** The parts one change of a page travels in at most. */
export const MAX_EDIT_PARTS = 120;
/** The characters of a change one part carries at most, leaving room for its frame. */
export const EDIT_PART_CHARS = 1_000;

const PAGE_ID = /^[0-9a-z]{1,16}$/;
const EDIT_ID = /^[0-9a-z]{1,24}$/;
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const KIND = /^[a-z][a-z-]{0,23}$/;
const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

const isAccess = (value: unknown): value is CompendiumAccess => value === 'read' || value === 'write';
const isCount = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

function parsePage(value: unknown): SharedPage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !PAGE_ID.test(value.id) || typeof value.kind !== 'string' || !KIND.test(value.kind) || !isAccess(value.access)) return null;
  const title = bookLine(value.title, MAX_PAGE_TITLE);
  return title === null ? null : { id: value.id, title, kind: value.kind, access: value.access };
}

function parseList<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items = value.map(parse);
  return items.every((item): item is T => item !== null) ? items : null;
}

const parseRow = (value: unknown): PageRow | null => {
  if (!isRecord(value)) return null;
  const label = bookLine(value.label, MAX_PAGE_TITLE);
  const text = bookText(value.value, MAX_ROW_VALUE);
  return label === null || text === null ? null : { label, value: text };
};

const parseSection = (value: unknown): PageSection | null => {
  if (!isRecord(value)) return null;
  const heading = bookLine(value.heading, MAX_PAGE_TITLE);
  const entries = parseList(value.entries, MAX_SECTION_ENTRIES, (entry) => {
    if (!isRecord(entry)) return null;
    const name = bookLine(entry.name, MAX_PAGE_TITLE, true);
    const text = bookText(entry.text, MAX_ROW_VALUE * 4);
    return name === null || text === null ? null : { name, text };
  });
  return heading === null || entries === null ? null : { heading, entries };
};

const parseField = (value: unknown): PageField | null => {
  if (!isRecord(value) || typeof value.key !== 'string' || !FIELD_KEY.test(value.key)) return null;
  const label = bookLine(value.label, MAX_PAGE_TITLE);
  const text = bookText(value.value, MAX_ROW_VALUE);
  return label === null || text === null ? null : { key: value.key, label, value: text };
};

/** A GM's compendium message as the player's page reads it, or null for anything malformed. */
export function parseCompendiumMessage(value: Record<string, unknown>): CompendiumMessage | null {
  if (value.t === 'compendium') {
    const pages = parseList(value.pages, MAX_SHARED_PAGES, parsePage);
    return pages === null ? null : { t: 'compendium', pages };
  }
  if (value.t === 'compendium-saved') {
    return typeof value.id === 'string' && PAGE_ID.test(value.id) && typeof value.ok === 'boolean' ? { t: 'compendium-saved', id: value.id, ok: value.ok } : null;
  }
  if (value.t !== 'compendium-entry' || !isRecord(value.page)) return null;
  const page = parsePage(value.page);
  const rows = parseList(value.page.rows, MAX_PAGE_ROWS, parseRow);
  const sections = parseList(value.page.sections, MAX_PAGE_SECTIONS, parseSection);
  const text = bookText(value.page.text, MAX_PAGE_TEXT);
  const fields = value.page.fields === undefined ? undefined : parseList(value.page.fields, MAX_PAGE_FIELDS, parseField);
  if (page === null || rows === null || sections === null || text === null || fields === null) return null;
  return { t: 'compendium-entry', page: { ...page, rows, sections, text, ...(fields !== undefined && { fields }) } };
}

/** A player's compendium message, by shape only: the GM checks what it may do. */
export function parsePlayerCompendiumMessage(value: Record<string, unknown>): PlayerCompendiumMessage | null {
  if (value.t === 'identify') return typeof value.key === 'string' && DEVICE_KEY.test(value.key) ? { t: 'identify', key: value.key } : null;
  if (typeof value.id !== 'string' || !PAGE_ID.test(value.id)) return null;
  if (value.t === 'compendium-open') return { t: 'compendium-open', id: value.id };
  if (value.t !== 'compendium-edit' || typeof value.edit !== 'string' || !EDIT_ID.test(value.edit)) return null;
  const { index, count, data } = value;
  if (!isCount(count, MAX_EDIT_PARTS) || count < 1 || !isCount(index, count - 1) || typeof data !== 'string' || data.length > EDIT_PART_CHARS) return null;
  return { t: 'compendium-edit', id: value.id, edit: value.edit, index, count, data };
}

export const isCompendiumType = (value: unknown): boolean => value === 'compendium' || value === 'compendium-entry' || value === 'compendium-saved';
export const isPlayerCompendiumType = (value: unknown): boolean => value === 'identify' || value === 'compendium-open' || value === 'compendium-edit';

/** A change of a page as the GM reads it once put together, or null for anything malformed. */
export function parsePageEdit(text: string): PageEdit | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.fields) || typeof raw.text !== 'string' || raw.text.length > MAX_PAGE_TEXT) return null;
  const entries = Object.entries(raw.fields);
  if (entries.length > MAX_PAGE_FIELDS) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!FIELD_KEY.test(key) || typeof value !== 'string' || value.length > MAX_ROW_VALUE) return null;
    fields[key] = value;
  }
  return { fields, text: raw.text };
}

/**
 * The parts a change of a page goes to the GM in: its JSON text cut into pieces small enough
 * for a player's frame. Null when the change would take more parts than a change may.
 */
export function pageEditParts(id: string, edit: string, change: PageEdit): PlayerCompendiumMessage[] | null {
  const text = JSON.stringify(change);
  const pieces: string[] = [];
  for (let start = 0; start < text.length;) {
    let size = Math.min(EDIT_PART_CHARS, text.length - start);
    // A piece of characters of many bytes may not fit a frame: it is cut smaller until it does.
    while (size > 1 && playerFrameBytes({ t: 'compendium-edit', id, edit, index: MAX_EDIT_PARTS, count: MAX_EDIT_PARTS, data: text.slice(start, start + size) }) > MAX_PLAYER_FRAME) size = Math.floor(size / 2);
    // Never between the two halves of a surrogate pair.
    const code = text.charCodeAt(start + size - 1);
    if (size > 1 && code >= 0xd800 && code <= 0xdbff) size -= 1;
    pieces.push(text.slice(start, start + size));
    start += size;
  }
  if (pieces.length > MAX_EDIT_PARTS) return null;
  return pieces.map((data, index) => ({ t: 'compendium-edit', id, edit, index, count: pieces.length, data }));
}
