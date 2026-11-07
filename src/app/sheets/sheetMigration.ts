/**
 * How a character sheet of the fork's former engine (`atlas-sheet: dnd5e-2024`) reads as a native
 * statblock of the 5E character template: its keys renamed to ones formulas can name, its picks
 * written as the template's French options, its tables as lists of entries. Pure.
 */

import { TEMPLATE_KEY } from '../statblocks/notes/statblockSource';
import { FIVE_E_2014_CHARACTER_ID, FIVE_E_2024_CHARACTER_ID } from '../statblocks/presets/fiveECharacter';
import { ABILITY_NAMES, ALIGNMENTS, SKILLS, SPELL_ABILITIES } from '../statblocks/presets/fiveECharacterFields';

/** The key that named a sheet's system in the former engine. */
export const FORMER_SHEET_KEY = 'atlas-sheet';

type Frontmatter = Record<string, unknown>;

const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const FORMER_ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unaligned'];

/** Keys that only changed their spelling. */
const RENAMED: Readonly<Record<string, string>> = {
  'hp-temp': 'hp_temp', 'initiative-bonus': 'initiative_bonus', 'hit-dice': 'hit_dice', 'hit-dice-spent': 'hit_dice_spent',
  'death-successes': 'death_successes', 'death-failures': 'death_failures',
};

/** What the former engine wrote beside the sheet for Fantasy Statblocks, worked out from it: the template works it out now. */
const WORKED_OUT = ['saves', 'skillsaves', 'senses', 'actions'];

const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row)) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map((entry) => (typeof entry === 'number' && Number.isFinite(entry) ? entry : 0)) : []);

/** Picks as the template stores them: one line, in the order of its options. */
function picks(chosen: readonly string[], names: readonly (readonly [string, string])[]): string {
  return names.filter(([id]) => chosen.includes(id)).map(([, name]) => name).join(', ');
}

/** An entry: its name, its text where it has one, and the parts of its row that the template keeps beside them. */
function entry(name: unknown, desc: unknown, parts: Record<string, unknown>): Record<string, unknown> {
  return { name: text(name), ...(text(desc) !== '' && { desc: text(desc) }), ...parts };
}

/** Each level's spell slots with what was spent of them, for the levels that have some. */
function spellSlots(slots: readonly number[], spent: readonly number[]): Record<string, unknown>[] {
  return slots.flatMap((max, level) => (max > 0 ? [{ name: `Niveau ${level + 1}`, max, used: Math.min(max, spent[level] ?? 0) }] : []));
}

/** The values to write and the keys to take out of a former sheet's frontmatter; null for a note that is none. */
export function migratedSheet(old: Readonly<Frontmatter>): { set: Frontmatter; remove: string[] } | null {
  const system = old[FORMER_SHEET_KEY];
  if (system !== 'dnd5e-2024' && system !== 'dnd5e-2014') return null;
  const set: Frontmatter = { statblock: true, [TEMPLATE_KEY]: system === 'dnd5e-2014' ? FIVE_E_2014_CHARACTER_ID : FIVE_E_2024_CHARACTER_ID };
  for (const [from, to] of Object.entries(RENAMED)) if (Object.hasOwn(old, from)) set[to] = old[from];
  const alignment = FORMER_ALIGNMENTS.indexOf(text(old.alignment));
  set.alignment = alignment >= 0 ? ALIGNMENTS[alignment] : text(old.alignment);
  const abilities = ABILITY_IDS.map((id, index): [string, string] => [id, ABILITY_NAMES[index] ?? id]);
  const skills = SKILLS.map(([id, name]): [string, string] => [id, name]);
  set.save_proficiencies = picks(ids(old['save-proficiencies']), abilities);
  set.skill_proficiencies = picks(ids(old['skill-proficiencies']), skills);
  set.skill_expertise = picks(ids(old['skill-expertise']), skills);
  set.inspiration = old.inspiration === true ? 'Oui' : '';
  const casting = ['int', 'wis', 'cha'].indexOf(text(old['spell-ability']));
  set.spell_ability = casting >= 0 ? SPELL_ABILITIES[casting] : '';
  set.classes = rows(old.classes).map((row) => entry(row.name, '', { level: typeof row.level === 'number' ? row.level : 1, die: text(row.die) }));
  set.attacks = rows(old.attacks).map((row) => entry(row.name, row.notes, { bonus: text(row.bonus), damage: text(row.damage) }));
  set.spell_list = rows(old['spell-list']).map((row) => entry(row.name, row.notes, { level: typeof row.level === 'number' ? row.level : 0, prepared: row.prepared === true ? 'Préparé' : '' }));
  set.traits = rows(old.traits).map((row) => entry(row.name, row.desc, {}));
  set.spell_slots = spellSlots(numbers(old['spell-slots']), numbers(old['spell-slots-spent']));
  for (const [key, value] of Object.entries(set)) if (value === '' || (Array.isArray(value) && value.length === 0)) delete set[key];
  const replaced = ['alignment', 'save-proficiencies', 'skill-proficiencies', 'skill-expertise', 'inspiration', 'spell-ability', 'spell-list', 'spell-slots', 'spell-slots-spent'];
  const remove = [FORMER_SHEET_KEY, ...Object.keys(RENAMED), ...replaced, ...WORKED_OUT].filter((key) => Object.hasOwn(old, key) && !Object.hasOwn(set, key));
  return { set, remove };
}
