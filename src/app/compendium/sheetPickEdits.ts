/**
 * What taking a compendium entry into a 5E character's statblock changes: the patches of its note's
 * fields (`fiveECharacterFields.ts`), and for a weapon or an armour the item that goes into the
 * character's book with the slot it is worn in. Pure: the entry is its name and frontmatter, the note
 * its frontmatter, the book what it holds once the item went in.
 */

import type { BookItem, BookItemDraft, PlayerBook } from '../online/protocol/book';
import type { FieldValue } from '../statblocks/model/templateTypes';
import type { NotePatch } from '../statblocks/notes/patchTypes';
import { toFieldValue } from '../statblocks/values/fieldValueOf';
import type { PickKind } from './pickKinds';

/** An item for the book and the slot it goes in: the hands for a weapon or a shield, the armour slot for armour. */
export interface BookGear {
  readonly item: Omit<BookItemDraft, 'id'>;
  readonly slot: 'main-hand' | 'off-hand' | 'armour';
}

/** What the book wears once a picked item went in: whether that item itself is worn, and the armour class a shield in the off hand adds (null: none). */
export interface WornGear {
  readonly equipped: boolean;
  readonly shield: number | null;
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

/** The armour class a shield's book item adds: the one its Armor Class property names, else null (no shield). */
function shieldBonusOf(item: BookItem): number | null {
  if (item.type?.trim().toLowerCase() !== 'shield') return null;
  const value = Number(item.properties.find((property) => property.label === 'Armor Class')?.value);
  return Number.isFinite(value) ? value : null;
}

/** What `book` wears of the item `id` and in the off hand, once that item went in. */
export function wornGear(book: Pick<PlayerBook, 'items' | 'equipped'>, id: string): WornGear {
  const offHand = book.equipped.find((entry) => entry.slot === 'off-hand');
  const shield = offHand === undefined ? undefined : book.items.find((item) => item.id === offHand.item);
  return { equipped: book.equipped.some((entry) => entry.item === id), shield: shield === undefined ? null : shieldBonusOf(shield) };
}

/**
 * The armour class an armour or a shield gives the character of a note once worn: an armour its base,
 * Dexterity up to its cap and the shield worn; a shield its bonus on what the note holds, which counts
 * no shield since the off hand was free. Null where the item is not worn or gives no armour class.
 */
export function armorClassWith(frontmatter: Frontmatter, note: Frontmatter, worn: WornGear): number | null {
  const base = frontmatter['armor-class'];
  if (!worn.equipped || typeof base !== 'number' || !Number.isFinite(base)) return null;
  if (isShield(frontmatter)) return Math.max(0, Math.min(50, (typeof note.ac === 'number' ? note.ac : 10) + base));
  const dex = modifierOf(note, 1);
  const cap = frontmatter['max-dex-bonus'];
  const bonus = frontmatter['dex-bonus'] === true ? (typeof cap === 'number' ? Math.min(dex, cap) : dex) : 0;
  return Math.max(0, Math.min(50, base + bonus + (worn.shield ?? 0)));
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

/** The item a weapon or an armour puts into the book, with the slot it is worn in; null for every other kind. */
export function gearOf(kind: PickKind, name: string, frontmatter: Frontmatter, body: string): BookGear | null {
  if (kind === 'weapon') return { item: bookItemOf(name, frontmatter, body), slot: 'main-hand' };
  if (kind === 'armor') return { item: bookItemOf(name, frontmatter, body), slot: isShield(frontmatter) ? 'off-hand' : 'armour' };
  return null;
}

/**
 * The note's patches for taking `name` of kind `kind`: a class is added with level 1 and its hit die
 * (once), a subclass, species or background is set, a spell joins the list (once), a weapon an attack
 * (once), and an armour sets the armour class where the book wears it (`worn`; null: no book kept).
 */
export function pickResult(kind: PickKind, name: string, frontmatter: Frontmatter, note: Frontmatter, worn: WornGear | null): NotePatch[] {
  switch (kind) {
    case 'class': {
      const classes = entriesOf(note, 'classes');
      if (has(classes, name) || classes.length >= 6) return [];
      const die = /d(\d+)/i.exec(text(frontmatter['hit-die']))?.[1];
      return [appended(note, 'classes', { name: cut(name, 40), level: 1, ...(die !== undefined && { die: `d${die}` }) })];
    }
    case 'subclass':
    case 'species':
    case 'background':
      return [setField(note, kind, cut(name, 120))];
    case 'spell': {
      if (has(entriesOf(note, 'spell_list'), name)) return [];
      const level = typeof frontmatter.level === 'number' ? Math.max(0, Math.min(9, Math.trunc(frontmatter.level))) : 0;
      const notes = [text(frontmatter['casting-time']), text(frontmatter.range), text(frontmatter.duration)].filter((part) => part !== '').join(' · ');
      return [appended(note, 'spell_list', { name: cut(name, 40), ...(notes !== '' && { desc: cut(notes, 120) }), level })];
    }
    case 'weapon':
      return has(entriesOf(note, 'attacks'), name) ? [] : [appended(note, 'attacks', attackOf(name, frontmatter, note))];
    case 'armor': {
      const ac = worn === null ? null : armorClassWith(frontmatter, note, worn);
      return ac === null ? [] : [setField(note, 'ac', ac)];
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
