/**
 * Monsters as native Atlas statblocks: `statblock: true` and the built-in 5E template of their
 * edition, with the keys that template reads. The same keys are Fantasy Statblocks', so that
 * plugin shows the notes as well.
 */

import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, type Note, type Property } from './notes.ts';
import { capitalize, indexOf, isJson, list, nameOf, num, prose, records, text, type Json } from './values.ts';

const TEMPLATE = { '2014': 'builtin:5e-2014-monster', '2024': 'builtin:5e-2024-monster' } as const;
const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
const ABILITY_NAMES: Readonly<Record<string, string>> = {
  STR: 'strength', DEX: 'dexterity', CON: 'constitution', INT: 'intelligence', WIS: 'wisdom', CHA: 'charisma',
};
const FRACTIONS: Readonly<Record<string, string>> = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2' };

export function registerMonsters(context: BuildContext): void {
  for (const monster of context.data('Monsters')) context.registry.register(FOLDERS.monsters, indexOf(monster), nameOf(monster));
}

/** "1/4" for 0.25: the challenge rating as the template's XP table names it. */
export function challengeRating(value: unknown): string {
  const rating = num(value);
  if (rating === undefined) return '';
  return FRACTIONS[String(rating)] ?? String(rating);
}

/** The first armour class with what gives it: "17 (natural armor)", "15 (leather armor, shield)". */
function armorClass(monster: Json): { value: number | undefined; note: string } {
  const first = records(monster.armor_class)[0];
  if (!first) return { value: undefined, note: '' };
  const armor = list(first.armor).map(nameOf).filter((name) => name !== '').join(', ').toLowerCase();
  const kind = text(first.type);
  const note = armor !== '' ? armor : kind === 'natural' ? 'natural armor' : '';
  return { value: num(first.value), note };
}

/** "30 ft., fly 90 ft. (hover), swim 30 ft." */
export function speedText(value: unknown): string {
  if (!isJson(value)) return '';
  const parts: string[] = [];
  for (const [mode, distance] of Object.entries(value)) {
    if (typeof distance !== 'string') continue;
    const hover = mode === 'fly' && value.hover === true ? ' (hover)' : '';
    parts.push(mode === 'walk' ? `${distance}${hover}` : `${mode} ${distance}${hover}`);
  }
  return parts.join(', ');
}

/** "darkvision 60 ft., passive Perception 10". */
export function sensesText(value: unknown): string {
  if (!isJson(value)) return '';
  const parts: string[] = [];
  for (const [sense, range] of Object.entries(value)) {
    if (sense === 'passive_perception') continue;
    if (typeof range === 'string') parts.push(`${sense} ${range}`);
  }
  const passive = num(value.passive_perception);
  if (passive !== undefined) parts.push(`passive Perception ${passive}`);
  return parts.join(', ');
}

/** Saving throws and skills as the template's pairs: `[{ dexterity: 5 }]`, `[{ perception: 4 }]`. */
function proficiencies(monster: Json, kind: 'Saving Throw' | 'Skill'): Property[] {
  const pairs: Property[] = [];
  for (const entry of records(monster.proficiencies)) {
    const [label, subject] = nameOf(entry.proficiency).split(':').map((part) => part.trim());
    const value = num(entry.value);
    if (label !== kind || subject === undefined || value === undefined) continue;
    const key = kind === 'Saving Throw' ? ABILITY_NAMES[subject] ?? subject.toLowerCase() : subject.toLowerCase();
    pairs.push({ [key]: value });
  }
  return pairs;
}

/** " (3/Day)", " (Recharge 5–6)", " (Recharges after a Short or Long Rest)": how often an entry can be used. */
export function usageSuffix(usage: unknown): string {
  if (!isJson(usage)) return '';
  const type = text(usage.type);
  if (type === 'per day') return ` (${num(usage.times) ?? 1}/Day)`;
  if (type === 'recharge on roll') {
    const min = num(usage.min_value);
    const sides = Number(text(usage.dice).split('d')[1] ?? '6') || 6;
    if (min === undefined) return '';
    return min === sides ? ` (Recharge ${min})` : ` (Recharge ${min}–${sides})`;
  }
  if (type === 'recharge after rest') {
    const rests = list(usage.rest_types).filter((rest): rest is string => typeof rest === 'string').map(capitalize);
    return rests.length === 0 ? '' : ` (Recharges after a ${rests.join(' or ')} Rest)`;
  }
  return '';
}

/** Traits and actions as entries: `{ name, desc }`. */
function entries(value: unknown): Property[] {
  return records(value).map((entry) => ({ name: `${nameOf(entry)}${usageSuffix(entry.usage)}`, desc: prose(entry) }));
}

function joined(value: unknown): string {
  return list(value).map((item) => (typeof item === 'string' ? item : nameOf(item))).filter((item) => item !== '').join(', ');
}

/** The 2014 line before legendary actions, which the SRD prints for every legendary creature. */
function legendaryIntro(context: BuildContext, monster: Json): string {
  if (context.edition !== '2014' || records(monster.legendary_actions).length === 0) return '';
  const name = nameOf(monster).toLowerCase();
  return `The ${name} can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The ${name} regains spent legendary actions at the start of its turn.`;
}

export function monsterNotes(context: BuildContext): Note[] {
  return context.data('Monsters').map((monster) => {
    const armor = armorClass(monster);
    const stats = ABILITIES.map((ability) => num(monster[ability]) ?? 10);
    const properties: Record<string, Property | undefined> = {
      statblock: true,
      'atlas-template': TEMPLATE[context.edition],
      ...entryProperties(context, 'monster'),
      name: nameOf(monster),
      size: text(monster.size),
      type: text(monster.type),
      subtype: text(monster.subtype),
      alignment: text(monster.alignment),
      ac: armor.value,
      // Fantasy Statblocks' key for what gives the armour class; the built-in templates do not show it yet.
      ac_class: armor.note,
      hp: num(monster.hit_points),
      hit_dice: text(monster.hit_points_roll) || text(monster.hit_dice),
      speed: speedText(monster.speed),
      stats,
      saves: proficiencies(monster, 'Saving Throw'),
      skillsaves: proficiencies(monster, 'Skill'),
      damage_vulnerabilities: joined(monster.damage_vulnerabilities),
      damage_resistances: joined(monster.damage_resistances),
      damage_immunities: joined(monster.damage_immunities),
      condition_immunities: joined(monster.condition_immunities),
      gear: text(monster.gear),
      senses: sensesText(monster.senses),
      languages: text(monster.languages),
      cr: challengeRating(monster.challenge_rating),
      traits: entries(monster.special_abilities),
      actions: entries(monster.actions),
      bonus_actions: entries(monster.bonus_actions),
      reactions: entries(monster.reactions),
      legendary_description: legendaryIntro(context, monster),
      legendary_actions: entries(monster.legendary_actions),
    };
    const path = context.registry.pathOf(FOLDERS.monsters, indexOf(monster)) ?? '';
    return { path, text: noteText(properties, prose(monster)) };
  });
}
