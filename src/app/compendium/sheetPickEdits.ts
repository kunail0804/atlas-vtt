/**
 * What taking a compendium entry into a 5E character's statblock changes: the patches of its note's
 * fields (`fiveECharacterFields.ts`), and for a weapon or an armour the item that goes into the
 * character's book with the slot it is worn in. Pure: the entry is its name and frontmatter, the note
 * its frontmatter.
 */

import type { BookItemDraft } from '../online/protocol/book';
import type { FieldValue } from '../statblocks/model/templateTypes';
import type { NotePatch } from '../statblocks/notes/patchTypes';
import { toFieldValue } from '../statblocks/values/fieldValueOf';
import type { PickKind } from './pickKinds';

/** An item for the book and the slot it goes in: the hands for a weapon or a shield, the armour slot for armour. */
export interface BookGear {
  readonly item: Omit<BookItemDraft, 'id'>;
  readonly slot: 'main-hand' | 'off-hand' | 'armour';
}

export interface PickResult {
  readonly patches: readonly NotePatch[];
  readonly gear: BookGear | null;
}

type Frontmatter = Readonly<Record<string, unknown>>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter((item) => item !== '') : text(value) === '' ? [] : [text(value)]);
const entriesOf = (note: Frontmatter, key: string): Record<string, FieldValue>[] => {
  const value = toFieldValue(note[key]);
  return Array.isArray(value) ? value.filter((item): item is Record<string, FieldValue> => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
};
const has = (entries: readonly Record<string, FieldValue>[], name: string): boolean => entries.some((entry) => text(entry.name).toLowerCase() === name.trim().toLowerCase());
const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);
const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);
/** `[[Classes/Fighter|Fighter]]` → `Fighter`. */
export const linkText = (value: string): string => value.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim();

/** The modifier of an ability (its column in `stats`), from a score of 10 where the note has none. */
function modifierOf(note: Frontmatter, ability: number): number {
  const stats = note.stats;
  const score = Array.isArray(stats) && typeof stats[ability] === 'number' ? stats[ability] : 10;
  return Math.floor((score - 10) / 2);
}

/** The proficiency bonus the note holds (worked out from its level), else the one of its level. */
function proficiencyOf(note: Frontmatter): number {
  if (typeof note.proficiency === 'number') return note.proficiency;
  const level = typeof note.level === 'number' ? note.level : 1;
  return Math.ceil(Math.max(1, Math.min(20, level)) / 4) + 1;
}

/** A field set to a new value, from what the note holds. */
function setField(note: Frontmatter, key: string, next: FieldValue): NotePatch {
  return { op: 'set', path: [key], base: Object.hasOwn(note, key) ? toFieldValue(note[key]) : undefined, next };
}

/** A list of entries with one more at its end. */
function appended(note: Frontmatter, key: string, entry: Record<string, FieldValue>): NotePatch {
  return setField(note, key, [...entriesOf(note, key), entry]);
}

/** Whether a compendium item is a weapon, an armour (a shield too), or neither. */
export function gearKind(frontmatter: Frontmatter): 'weapon' | 'armor' | null {
  const type = text(frontmatter['item-type']).toLowerCase();
  if (type === 'weapon' || text(frontmatter['weapon-category']) !== '') return 'weapon';
  if (type === 'armor' || type === 'shield' || text(frontmatter['armor-category']) !== '' || typeof frontmatter['armor-class'] === 'number') return 'armor';
  return null;
}

const isShield = (frontmatter: Frontmatter): boolean => text(frontmatter['item-type']).toLowerCase() === 'shield' || text(frontmatter['armor-category']).toLowerCase() === 'shield';

/** The armour class an armour gives the character of a note: its base, Dexterity up to its cap, +2 for a shield on what they had. */
export function armorClassWith(frontmatter: Frontmatter, note: Frontmatter): number | null {
  const base = frontmatter['armor-class'];
  if (typeof base !== 'number' || !Number.isFinite(base)) return null;
  if (isShield(frontmatter)) return Math.min(50, (typeof note.ac === 'number' ? note.ac : 10) + base);
  const dex = modifierOf(note, 1);
  const cap = frontmatter['max-dex-bonus'];
  const bonus = frontmatter['dex-bonus'] === true ? (typeof cap === 'number' ? Math.min(dex, cap) : dex) : 0;
  return Math.max(0, Math.min(50, base + bonus));
}

/** A weapon's attack for the character of a note, as an entry: Strength, Dexterity for a ranged weapon, the better for a finesse one. */
export function attackOf(name: string, frontmatter: Frontmatter, note: Frontmatter): Record<string, FieldValue> {
  const properties = words(frontmatter.properties).map(linkText);
  const finesse = properties.some((property) => /finesse/i.test(property));
  const ranged = /ranged/i.test(text(frontmatter['weapon-category']));
  const modifier = finesse ? Math.max(modifierOf(note, 0), modifierOf(note, 1)) : ranged ? modifierOf(note, 1) : modifierOf(note, 0);
  const dice = text(frontmatter.damage);
  const damage = dice === '' ? '' : `${dice}${modifier === 0 ? '' : signed(modifier)} ${text(frontmatter['damage-type']).toLowerCase()}`.trim();
  const notes = [text(frontmatter.range), properties.join(', ')].filter((part) => part !== '').join(' · ');
  return { name: cut(name, 40), ...(notes !== '' && { desc: cut(notes, 120) }), bonus: signed(proficiencyOf(note) + modifier), damage: cut(damage, 120) };
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
 * The note's patches for taking `name` of kind `kind`: a class is added with level 1 and its hit die
 * (once), a subclass, species or background is set, a spell joins the list (once), a weapon an attack
 * (once) and an armour sets the armour class. A weapon and an armour also go into the book.
 */
export function pickResult(kind: PickKind, name: string, frontmatter: Frontmatter, body: string, note: Frontmatter): PickResult {
  switch (kind) {
    case 'class': {
      const classes = entriesOf(note, 'classes');
      if (has(classes, name) || classes.length >= 6) return { patches: [], gear: null };
      const die = /d(\d+)/i.exec(text(frontmatter['hit-die']))?.[1];
      return { patches: [appended(note, 'classes', { name: cut(name, 40), level: 1, ...(die !== undefined && { die: `d${die}` }) })], gear: null };
    }
    case 'subclass':
    case 'species':
    case 'background':
      return { patches: [setField(note, kind, cut(name, 120))], gear: null };
    case 'spell': {
      if (has(entriesOf(note, 'spell_list'), name)) return { patches: [], gear: null };
      const level = typeof frontmatter.level === 'number' ? Math.max(0, Math.min(9, Math.trunc(frontmatter.level))) : 0;
      const notes = [text(frontmatter['casting-time']), text(frontmatter.range), text(frontmatter.duration)].filter((part) => part !== '').join(' · ');
      return { patches: [appended(note, 'spell_list', { name: cut(name, 40), ...(notes !== '' && { desc: cut(notes, 120) }), level })], gear: null };
    }
    case 'weapon': {
      const patches = has(entriesOf(note, 'attacks'), name) ? [] : [appended(note, 'attacks', attackOf(name, frontmatter, note))];
      return { patches, gear: { item: bookItemOf(name, frontmatter, body), slot: 'main-hand' } };
    }
    case 'armor': {
      const ac = armorClassWith(frontmatter, note);
      return { patches: ac === null ? [] : [setField(note, 'ac', ac)], gear: { item: bookItemOf(name, frontmatter, body), slot: isShield(frontmatter) ? 'off-hand' : 'armour' } };
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
