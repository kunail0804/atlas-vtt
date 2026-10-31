/**
 * What taking a compendium entry into a 5e character sheet changes: the sheet's edits, and for a
 * weapon or an armour the item that goes into the character's book with the slot it is worn in.
 * Pure: the entry is its name and frontmatter, the sheet its values.
 */

import { deriveDnd5e, signed } from '../characterSheets/dnd5e2024';
import type { SheetRow, SheetValues } from '../characterSheets/sheetFields';
import type { SheetEdit } from '../characterSheets/sheetNote';
import type { PickKind } from '../characterSheets/sheetCompendium';
import type { BookItemDraft } from '../online/protocol/book';

/** An item for the book and the slot it goes in: the hands for a weapon or a shield, the armour slot for armour. */
export interface BookGear {
  readonly item: Omit<BookItemDraft, 'id'>;
  readonly slot: 'main-hand' | 'off-hand' | 'armour';
}

export interface PickResult {
  readonly edits: readonly SheetEdit[];
  readonly gear: BookGear | null;
}

type Frontmatter = Readonly<Record<string, unknown>>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter((item) => item !== '') : text(value) === '' ? [] : [text(value)]);
const rowsOf = (values: SheetValues, key: string): readonly SheetRow[] => (Array.isArray(values[key]) ? (values[key] as readonly SheetRow[]) : []);
const has = (rows: readonly SheetRow[], name: string): boolean => rows.some((row) => String(row.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);
/** `[[Classes/Fighter|Fighter]]` → `Fighter`. */
export const linkText = (value: string): string => value.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim();

/** Whether a compendium item is a weapon, an armour (a shield too), or neither. */
export function gearKind(frontmatter: Frontmatter): 'weapon' | 'armor' | null {
  const type = text(frontmatter['item-type']).toLowerCase();
  if (type === 'weapon' || text(frontmatter['weapon-category']) !== '') return 'weapon';
  if (type === 'armor' || type === 'shield' || text(frontmatter['armor-category']) !== '' || typeof frontmatter['armor-class'] === 'number') return 'armor';
  return null;
}

const isShield = (frontmatter: Frontmatter): boolean => text(frontmatter['item-type']).toLowerCase() === 'shield' || text(frontmatter['armor-category']).toLowerCase() === 'shield';

/** The armour class an armour gives a character of these values: its base, Dexterity up to its cap, +2 for a shield on what they had. */
export function armorClassWith(frontmatter: Frontmatter, values: SheetValues): number | null {
  const base = frontmatter['armor-class'];
  if (typeof base !== 'number' || !Number.isFinite(base)) return null;
  if (isShield(frontmatter)) return Math.min(50, (typeof values.ac === 'number' ? values.ac : 10) + base);
  const dex = deriveDnd5e(values).modifiers.dex;
  const cap = frontmatter['max-dex-bonus'];
  const bonus = frontmatter['dex-bonus'] === true ? (typeof cap === 'number' ? Math.min(dex, cap) : dex) : 0;
  return Math.max(0, Math.min(50, base + bonus));
}

/** A weapon's attack for a character of these values: Strength, Dexterity for a ranged weapon, the better for a finesse one. */
export function attackOf(name: string, frontmatter: Frontmatter, values: SheetValues): SheetRow {
  const derived = deriveDnd5e(values);
  const properties = words(frontmatter.properties).map(linkText);
  const finesse = properties.some((property) => /finesse/i.test(property));
  const ranged = /ranged/i.test(text(frontmatter['weapon-category']));
  const modifier = finesse ? Math.max(derived.modifiers.str, derived.modifiers.dex) : ranged ? derived.modifiers.dex : derived.modifiers.str;
  const dice = text(frontmatter.damage);
  const damage = dice === '' ? '' : `${dice}${modifier === 0 ? '' : signed(modifier)} ${text(frontmatter['damage-type']).toLowerCase()}`.trim();
  const notes = [text(frontmatter.range), properties.join(', ')].filter((part) => part !== '').join(' · ');
  return { name: cut(name, 40), bonus: signed(derived.proficiency + modifier), damage: cut(damage, 120), notes: cut(notes, 120) };
}

/** The item the book keeps of a weapon or an armour, its text as the compendium has it. */
export function bookItemOf(name: string, frontmatter: Frontmatter, body: string): Omit<BookItemDraft, 'id'> {
  const property = (label: string, value: string): { label: string; value: string } | null => (value === '' ? null : { label, value: cut(value, 200) });
  const properties = [
    property('Damage', [text(frontmatter.damage), text(frontmatter['damage-type'])].filter((part) => part !== '').join(' ')),
    property('Armor Class', text(frontmatter['armor-class'])),
    property('Range', text(frontmatter.range)),
    property('Properties', words(frontmatter.properties).map(linkText).join(', ')),
    property('Weight', text(frontmatter.weight)),
  ].filter((entry): entry is { label: string; value: string } => entry !== null);
  const type = text(frontmatter['weapon-category']) || text(frontmatter['armor-category']) || text(frontmatter['item-type']);
  return {
    name: cut(name, 80),
    type: type === '' ? null : cut(type, 80),
    rarity: text(frontmatter.rarity) === '' ? null : cut(text(frontmatter.rarity), 80),
    price: text(frontmatter.cost) === '' ? null : cut(text(frontmatter.cost), 80),
    description: body.trim() === '' ? null : cut(body.trim(), 4000),
    properties,
  };
}

/**
 * The sheet's edits for taking `name` of kind `kind`: a class is added with level 1 and its hit die
 * (once), a subclass, species or background is set, a spell joins the list (once), a weapon an attack
 * (once) and an armour sets the armour class. A weapon and an armour also go into the book.
 */
export function pickResult(kind: PickKind, name: string, frontmatter: Frontmatter, body: string, values: SheetValues): PickResult {
  switch (kind) {
    case 'class': {
      const classes = rowsOf(values, 'classes');
      if (has(classes, name) || classes.length >= 6) return { edits: [], gear: null };
      const die = /d(\d+)/i.exec(text(frontmatter['hit-die']))?.[1];
      return { edits: [{ op: 'row', key: 'classes', index: classes.length, row: { name: cut(name, 40), level: 1, die: die === undefined ? '' : `d${die}` } }], gear: null };
    }
    case 'subclass':
    case 'species':
    case 'background':
      return { edits: [{ op: 'set', key: kind, value: cut(name, 120) }], gear: null };
    case 'spell': {
      const spells = rowsOf(values, 'spell-list');
      if (has(spells, name)) return { edits: [], gear: null };
      const level = typeof frontmatter.level === 'number' ? Math.max(0, Math.min(9, Math.trunc(frontmatter.level))) : 0;
      const notes = [text(frontmatter['casting-time']), text(frontmatter.range), text(frontmatter.duration)].filter((part) => part !== '').join(' · ');
      return { edits: [{ op: 'row', key: 'spell-list', index: spells.length, row: { level, name: cut(name, 40), prepared: false, notes: cut(notes, 120) } }], gear: null };
    }
    case 'weapon': {
      const attacks = rowsOf(values, 'attacks');
      const edits: SheetEdit[] = has(attacks, name) ? [] : [{ op: 'row', key: 'attacks', index: attacks.length, row: attackOf(name, frontmatter, values) }];
      return { edits, gear: { item: bookItemOf(name, frontmatter, body), slot: 'main-hand' } };
    }
    case 'armor': {
      const ac = armorClassWith(frontmatter, values);
      return { edits: ac === null ? [] : [{ op: 'set', key: 'ac', value: ac }], gear: { item: bookItemOf(name, frontmatter, body), slot: isShield(frontmatter) ? 'off-hand' : 'armour' } };
    }
  }
}

/** What the picker shows beside an entry's name: a class's hit die, a spell's level and school, a weapon's damage, an armour's class. */
export function choiceDetail(kind: PickKind, frontmatter: Frontmatter): string {
  switch (kind) {
    case 'class': return text(frontmatter['hit-die']);
    case 'spell': return [typeof frontmatter.level === 'number' ? (frontmatter.level === 0 ? 'Cantrip' : `Level ${frontmatter.level}`) : '', text(frontmatter.school)].filter((part) => part !== '').join(' · ');
    case 'weapon': return [text(frontmatter.damage), text(frontmatter['damage-type'])].filter((part) => part !== '').join(' ');
    case 'armor': return text(frontmatter['armor-class']) === '' ? '' : `AC ${text(frontmatter['armor-class'])}`;
    case 'subclass': return linkText(text(frontmatter.class));
    default: return '';
  }
}
