/**
 * A compendium note as a player reads it once the GM shares it: its title and kind, the lines of
 * its card, a statblock's named entries (a monster's Actions), and its text. And the properties
 * a player allowed to change it may change, with how their change is written back.
 */

import { builtInTemplate } from '../statblocks/library/builtInTemplates';
import type { TemplateField } from '../statblocks/model/templateTypes';
import { TEMPLATE_KEY } from '../statblocks/notes/statblockSource';
import type { PageField, PageRow, PageSection } from '../online/protocol/compendium';
import { cardName, cardRows, splitNote } from './entryCard';
import { ENTRY_KIND_KEY, isEntryKind } from './sourceFormat';

export interface PageContent {
  readonly title: string;
  readonly kind: string;
  readonly rows: readonly PageRow[];
  readonly sections: readonly PageSection[];
  readonly text: string;
  /** What a player allowed to change the page may change. */
  readonly fields: readonly PageField[];
}

const ABILITY_SLOTS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isScalar = (value: unknown): value is string | number => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

function plain(value: unknown, yes: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? yes : '';
  if (Array.isArray(value)) return value.map((item) => plain(item, yes)).filter((item) => item !== '').join(', ');
  if (isRecord(value)) return Object.entries(value).map(([key, item]) => `${key} ${plain(item, yes)}`).join(', ');
  return '';
}

/** "STR 8 (−1), DEX 14 (+2), …": ability scores with their modifiers. */
function scoresText(value: unknown, slots: readonly string[]): string {
  if (!Array.isArray(value)) return plain(value, '');
  return value.map((score, index) => {
    const label = slots[index] ?? ABILITY_SLOTS[index] ?? String(index + 1);
    return typeof score === 'number' ? `${label} ${score} (${signed(Math.floor((score - 10) / 2))})` : `${label} ${plain(score, '')}`;
  }).join(', ');
}

/** "Dexterity +4, Stealth +6": a statblock's pairs, as `[{ dexterity: 4 }]` or `{ dexterity: 4 }`. */
function pairsText(value: unknown): string {
  const pairs = Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [];
  return pairs.flatMap((pair) => Object.entries(pair)).map(([key, item]) => {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    return typeof item === 'number' ? `${name} ${signed(item)}` : `${name} ${plain(item, '')}`;
  }).join(', ');
}

/** A statblock's named entries: `[{ name, desc }]`. */
function entriesOf(value: unknown): Array<{ name: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({ name: plain(entry.name, ''), text: plain(entry.desc ?? entry.description ?? '', '') }))
    .filter((entry) => entry.name !== '' || entry.text !== '');
}

/** A native statblock's lines and entries, in its template's order. */
function statblockParts(frontmatter: Readonly<Record<string, unknown>>, fields: readonly TemplateField[], yes: string): { rows: PageRow[]; sections: PageSection[]; editable: PageField[] } {
  const rows: PageRow[] = [];
  const sections: PageSection[] = [];
  const editable: PageField[] = [];
  for (const field of fields) {
    const value = frontmatter[field.key];
    if (field.key === 'name' || field.type === 'image' || value === undefined || value === null) continue;
    if (isScalar(value) && ['text', 'number', 'rating', 'dice', 'choice', 'markdown'].includes(field.type)) {
      editable.push({ key: field.key, label: field.label, value: String(value) });
    }
    // What gives the armour class stands beside it: "15 (leather armor, shield)".
    if (field.key === 'ac_class') continue;
    if (field.type === 'entries') {
      const entries = entriesOf(value);
      if (entries.length > 0) sections.push({ heading: field.label, entries });
      continue;
    }
    let text: string;
    if (field.type === 'scores') text = scoresText(value, field.slots ?? []);
    else if (field.type === 'pairs') text = pairsText(value);
    else text = plain(value, yes);
    if (field.key === 'ac' && typeof frontmatter.ac_class === 'string' && frontmatter.ac_class.trim() !== '') text = `${text} (${frontmatter.ac_class.trim()})`;
    if (text !== '') rows.push({ label: field.label, value: text });
  }
  return { rows, sections, editable };
}

/** The page a player reads of a note: `fallbackName` names a note whose properties give no name. */
export function pageContentOf(noteText: string, fallbackName: string, yes: string): PageContent {
  const { frontmatter, body } = splitNote(noteText);
  const declared = frontmatter[ENTRY_KIND_KEY];
  const kind = isEntryKind(declared) ? declared : 'other';
  const title = cardName(frontmatter, fallbackName);
  const templateId = frontmatter[TEMPLATE_KEY];
  const template = frontmatter.statblock === true && typeof templateId === 'string' ? builtInTemplate(templateId)?.template : undefined;
  if (template) {
    const { rows, sections, editable } = statblockParts(frontmatter, template.fields, yes);
    return { title, kind, rows, sections, text: body, fields: editable };
  }
  const rows = cardRows(kind, frontmatter, yes);
  const fields: PageField[] = [];
  for (const row of rows) {
    const value = frontmatter[row.key];
    if (isScalar(value)) fields.push({ key: row.key, label: row.label, value: String(value) });
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) fields.push({ key: row.key, label: row.label, value: value.join(', ') });
  }
  return {
    title,
    kind,
    rows: rows.map((row) => ({ label: row.label, value: typeof row.value === 'string' ? row.value : row.value.join(', ') })),
    sections: [],
    text: body,
    fields,
  };
}

/**
 * A player's change of a property, as the note's frontmatter takes it: a number stays a number
 * when the player wrote one, a list stays a list (split on commas). Null for a property the page
 * does not let them change.
 */
export function editedValue(previous: unknown, written: string): string | number | string[] | null {
  if (Array.isArray(previous)) return written.split(',').map((item) => item.trim()).filter((item) => item !== '');
  if (typeof previous === 'number') {
    const number = Number(written.trim());
    return written.trim() !== '' && Number.isFinite(number) ? number : written;
  }
  return typeof previous === 'string' ? written : null;
}

/** The note's text with its body replaced by `body`; its frontmatter, as written, stays. */
export function withBody(noteText: string, body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(noteText);
  const head = match ? match[0].endsWith('\n') ? match[0] : `${match[0]}\n` : '';
  const text = body.trim();
  return text === '' ? head : `${head}${text}\n`;
}
