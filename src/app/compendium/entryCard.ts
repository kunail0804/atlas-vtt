/**
 * A compendium entry drawn as a statblock card: every kind of entry (a spell, an item, a class…)
 * reads like a monster's statblock in the compendium. The note is not changed. The card is drawn
 * from a copy of its text, made a statblock of a template built for it: one row per property,
 * in the order its kind lists them, then the note's text.
 */

import { stringifyYaml } from 'obsidian';
import { parseNoteYaml } from '../services/noteYaml';
import { TEMPLATE_FORMAT, TEMPLATE_VERSION, type StatblockTemplate, type TemplateBlock, type TemplateField } from '../statblocks/model/templateTypes';
import type { LibraryTemplate } from '../statblocks/model/resolvedTypes';
import { TEMPLATE_KEY } from '../statblocks/notes/statblockSource';
import { withHeader } from '../statblocks/model/headerDuplicates';
import type { EntryGroup } from './compendiumEntries';

/** A property the card shows, its label, and whether it is a list (shown comma-separated). */
type Row = readonly [key: string, label: string, list?: 'list'];

/** The properties of each kind, in the order the card shows them. Others the note has follow them. */
const ROWS: Readonly<Record<EntryGroup, readonly Row[]>> = {
  spell: [
    ['level', 'Level'], ['school', 'School'], ['casting-time', 'Casting Time'], ['range', 'Range'], ['components', 'Components', 'list'], ['material', 'Material'],
    ['duration', 'Duration'], ['concentration', 'Concentration'], ['ritual', 'Ritual'], ['attack-type', 'Attack'],
    ['save', 'Saving Throw'], ['save-success', 'On a Success'], ['damage-type', 'Damage Type'],
    ['damage-at-slot-level', 'Damage by Slot Level'], ['damage-at-character-level', 'Damage by Character Level'],
    ['classes', 'Classes', 'list'],
  ],
  item: [
    ['item-type', 'Type'], ['categories', 'Categories', 'list'], ['cost', 'Cost'], ['weight', 'Weight'],
    ['weapon-category', 'Weapon Category'], ['damage', 'Damage'], ['two-handed-damage', 'Two-Handed Damage'],
    ['damage-type', 'Damage Type'], ['range', 'Range'], ['properties', 'Properties', 'list'], ['mastery', 'Mastery'],
    ['armor-category', 'Armor Category'], ['armor-class', 'Armor Class'], ['dex-bonus', 'Dex Bonus'],
    ['max-dex-bonus', 'Max Dex Bonus'], ['strength-minimum', 'Strength'], ['stealth-disadvantage', 'Stealth Disadvantage'],
  ],
  'magic-item': [
    ['category', 'Category'], ['rarity', 'Rarity'], ['attunement', 'Requires Attunement'], ['variant', 'Variant'],
    ['variants', 'Variants', 'list'],
  ],
  class: [
    ['hit-die', 'Hit Die'], ['primary-ability', 'Primary Ability'], ['saving-throws', 'Saving Throws', 'list'],
    ['proficiencies', 'Proficiencies', 'list'], ['skill-choices', 'Skills', 'list'], ['spellcasting-ability', 'Spellcasting Ability'],
    ['multiclass-prerequisites', 'Multiclass Prerequisites'], ['subclasses', 'Subclasses', 'list'],
  ],
  subclass: [['class', 'Class'], ['flavor', 'Flavor'], ['summary', 'Summary']],
  species: [
    ['creature-type', 'Creature Type'], ['size', 'Size'], ['speed', 'Speed'], ['ability-bonuses', 'Ability Bonuses'],
    ['languages', 'Languages', 'list'], ['traits', 'Traits', 'list'], ['subraces', 'Subraces', 'list'], ['lineages', 'Lineages', 'list'],
  ],
  background: [['ability-scores', 'Ability Scores'], ['feat', 'Feat'], ['proficiencies', 'Proficiencies', 'list']],
  feat: [['feat-type', 'Type'], ['prerequisites', 'Prerequisites']],
  condition: [],
  rule: [['chapter', 'Chapter'], ['license', 'Licence']],
  monster: [],
  other: [],
};

/** Properties that are Atlas' or Obsidian's own, never shown on the card. */
const HIDDEN = new Set(['name', 'statblock', TEMPLATE_KEY, 'position', 'tags', 'aliases', 'cssclasses', 'image']);
/** The field the note's text goes in. */
const BODY_KEY = 'card_text';
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface EntryCard {
  /** The note's text made a statblock of `template`. */
  text: string;
  template: LibraryTemplate;
}

function labelOf(key: string): string {
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function textOf(value: unknown, yes: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? yes : '';
  if (Array.isArray(value)) return value.map((item) => textOf(item, yes)).filter((item) => item !== '').join(', ');
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([key, item]) => `${key}: ${textOf(item, yes)}`).join(', ');
  }
  return '';
}

function listOf(value: unknown, yes: string): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => textOf(item, yes)).filter((item) => item !== '');
}

/** A short, stable hash, so a card's template id changes with the fields it shows. */
function hashOf(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

const blockId = (index: number): string => `cc${index.toString(36).padStart(6, '0')}`;

/** The note's frontmatter and body; an empty frontmatter where it has none or it cannot be read. */
export function splitNote(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: {}, body: text.trim() };
  let parsed: unknown;
  try {
    parsed = parseNoteYaml(match[1] ?? '');
  } catch {
    parsed = null;
  }
  const frontmatter = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  return { frontmatter, body: text.slice(match[0].length).trim() };
}

/** One line of a card: a property, its label, and its value as text or as a list. */
export interface CardRow {
  readonly key: string;
  readonly label: string;
  readonly value: string | readonly string[];
}

/**
 * The lines a card shows of an entry's properties: those its kind lists, in that order, then the
 * others the note has. A true property shows as `yes`; false and empty ones are left off.
 */
export function cardRows(group: EntryGroup, frontmatter: Readonly<Record<string, unknown>>, yes: string): CardRow[] {
  const known = ROWS[group];
  const rows: Row[] = [...known];
  for (const key of Object.keys(frontmatter)) {
    if (HIDDEN.has(key) || key.startsWith('atlas-') || !FIELD_KEY.test(key) || key === BODY_KEY) continue;
    if (known.some(([knownKey]) => knownKey === key)) continue;
    rows.push(Array.isArray(frontmatter[key]) ? [key, labelOf(key), 'list'] : [key, labelOf(key)]);
  }
  const shown: CardRow[] = [];
  for (const [key, label, list] of rows) {
    const value = frontmatter[key];
    if (list === 'list') {
      const items = listOf(value, yes);
      if (items.length > 0) shown.push({ key, label, value: items });
    } else {
      const text = textOf(value, yes);
      if (text !== '') shown.push({ key, label, value: text });
    }
  }
  return shown;
}

/** The name an entry's card shows: its `name` property, else `fallbackName`. */
export function cardName(frontmatter: Readonly<Record<string, unknown>>, fallbackName: string): string {
  return typeof frontmatter.name === 'string' && frontmatter.name.trim() !== '' ? frontmatter.name : fallbackName;
}

/**
 * The card of a compendium note: its text as a statblock of a template made for it. A true
 * property shows as `yes`; false and empty ones are left off. `name` falls back to `fallbackName`.
 * `withText: false` leaves the note's text off, for a card drawn beside the note itself.
 */
export function entryCard(group: EntryGroup, noteText: string, fallbackName: string, yes: string, options: { withText?: boolean } = {}): EntryCard {
  const { frontmatter, body } = splitNote(noteText);
  const values: Record<string, unknown> = {};
  const fields: TemplateField[] = [{ key: 'name', label: 'Name', type: 'text' }];
  const blocks: TemplateBlock[] = [];
  for (const row of cardRows(group, frontmatter, yes)) {
    // A field of the card's own: a property such as `level` or `type` would be taken for a part of the header.
    const key = `card_${fields.length}`;
    values[key] = row.value;
    if (typeof row.value === 'string') {
      fields.push({ key, label: row.label, type: 'text' });
      blocks.push({ id: blockId(blocks.length), type: 'stat', field: key, label: row.label, look: 'run-in' });
    } else {
      fields.push({ key, label: row.label, type: 'list' });
      blocks.push({ id: blockId(blocks.length), type: 'tags', field: key, label: row.label, look: 'comma' });
    }
  }
  if (body !== '' && options.withText !== false) {
    if (blocks.length > 0) blocks.push({ id: blockId(blocks.length), type: 'divider' });
    values[BODY_KEY] = body;
    fields.push({ key: BODY_KEY, label: 'Text', type: 'markdown' });
    blocks.push({ id: blockId(blocks.length), type: 'text', field: BODY_KEY });
  }

  const id = `compendium-card-${group}-${hashOf(fields.map((field) => `${field.label}:${field.type}`).join('|'))}`;
  const template: StatblockTemplate = withHeader({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id,
    fields,
    header: { hidden: ['token', 'level', 'type', 'hp', 'description'] },
    layout: { maxColumns: 1, columnWidth: 22, blocks },
  });
  const card = { statblock: true, [TEMPLATE_KEY]: id, name: cardName(frontmatter, fallbackName), ...values };
  return {
    text: `---\n${stringifyYaml(card)}---\n`,
    template: { template, name: labelOf(group), status: 'ok', builtIn: false, path: null },
  };
}
