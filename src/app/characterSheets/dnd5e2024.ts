import type { CellSpec, FieldSpec, SheetRow, SheetValues } from './sheetFields.ts';
import type { NoteValue, SheetSystem } from './sheetSystem.ts';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

/** The 2024 rules' skills, each with the ability it rolls with, in the sheet's order. */
export const SKILLS: ReadonlyArray<readonly [string, Ability]> = [
  ['acrobatics', 'dex'], ['animal-handling', 'wis'], ['arcana', 'int'], ['athletics', 'str'], ['deception', 'cha'], ['history', 'int'],
  ['insight', 'wis'], ['intimidation', 'cha'], ['investigation', 'int'], ['medicine', 'wis'], ['nature', 'int'], ['perception', 'wis'],
  ['performance', 'cha'], ['persuasion', 'cha'], ['religion', 'int'], ['sleight-of-hand', 'dex'], ['stealth', 'dex'], ['survival', 'wis'],
];
export const SKILL_IDS = SKILLS.map(([id]) => id);
export const ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unaligned'];

const LINE: CellSpec = { kind: 'text', max: 120 };
const SHORT: CellSpec = { kind: 'text', max: 40 };
const LONG = (max: number): CellSpec => ({ kind: 'longtext', max });
const NUMBER = (min: number, max: number): CellSpec => ({ kind: 'int', min, max });

/** Every field of a 2024 character sheet, by its frontmatter key; `name`, `ac`, `hp`, `stats`, `speed`, `languages` and `traits` are Fantasy Statblocks' own. */
export const DND5E_2024_FIELDS: Readonly<Record<string, FieldSpec>> = {
  name: LINE,
  class: LINE,
  subclass: LINE,
  level: NUMBER(1, 20),
  species: LINE,
  background: LINE,
  alignment: { kind: 'choice', options: ALIGNMENTS },
  xp: NUMBER(0, 1_000_000),
  stats: { kind: 'ints', length: 6, min: 1, max: 30 },
  'save-proficiencies': { kind: 'set', options: ABILITIES },
  'skill-proficiencies': { kind: 'set', options: SKILL_IDS },
  'skill-expertise': { kind: 'set', options: SKILL_IDS },
  inspiration: { kind: 'bool' },
  ac: NUMBER(0, 50),
  hp: NUMBER(0, 9_999),
  'hp-temp': NUMBER(0, 9_999),
  speed: SHORT,
  'initiative-bonus': NUMBER(-20, 20),
  'hit-dice': SHORT,
  'hit-dice-spent': NUMBER(0, 40),
  'death-successes': NUMBER(0, 3),
  'death-failures': NUMBER(0, 3),
  languages: LONG(500),
  proficiencies: LONG(1_000),
  attacks: { kind: 'rows', max: 20, cells: { name: SHORT, bonus: SHORT, damage: LINE, notes: LINE } },
  'spell-ability': { kind: 'choice', options: ['int', 'wis', 'cha'] },
  'spell-slots': { kind: 'ints', length: 9, min: 0, max: 9 },
  'spell-slots-spent': { kind: 'ints', length: 9, min: 0, max: 9 },
  'spell-list': { kind: 'rows', max: 80, cells: { level: NUMBER(0, 9), name: SHORT, prepared: { kind: 'bool' }, notes: LINE } },
  equipment: { kind: 'rows', max: 80, cells: { name: SHORT, quantity: NUMBER(0, 9_999), weight: SHORT, notes: LINE } },
  cp: NUMBER(0, 1_000_000), sp: NUMBER(0, 1_000_000), ep: NUMBER(0, 1_000_000), gp: NUMBER(0, 1_000_000), pp: NUMBER(0, 1_000_000),
  traits: { kind: 'rows', max: 40, cells: { name: SHORT, desc: LONG(2_000) } },
  personality: LONG(1_000),
  ideals: LONG(1_000),
  bonds: LONG(1_000),
  flaws: LONG(1_000),
  appearance: LONG(1_000),
  backstory: LONG(4_000),
};

/** What follows from a 2024 sheet: modifiers and bonuses as the rules work them out. */
export interface Dnd5eDerived {
  readonly proficiency: number;
  readonly modifiers: Readonly<Record<Ability, number>>;
  readonly saves: Readonly<Record<Ability, number>>;
  readonly skills: Readonly<Record<string, number>>;
  readonly initiative: number;
  readonly passivePerception: number;
  /** Null without a spellcasting ability. */
  readonly spellSaveDc: number | null;
  readonly spellAttack: number | null;
}

const numberOf = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const listOf = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);
/** +2 at levels 1–4, +3 at 5–8, … +6 at 17–20. */
export const proficiencyBonus = (level: number): number => Math.ceil(Math.max(1, Math.min(20, level)) / 4) + 1;

export function deriveDnd5e(values: SheetValues): Dnd5eDerived {
  const stats = Array.isArray(values.stats) ? values.stats : [];
  const proficiency = proficiencyBonus(numberOf(values.level, 1));
  const modifiers = Object.fromEntries(ABILITIES.map((ability, index) => [ability, abilityModifier(numberOf(stats[index], 10))])) as Record<Ability, number>;
  const saving = new Set(listOf(values['save-proficiencies']));
  const proficient = new Set(listOf(values['skill-proficiencies']));
  const expert = new Set(listOf(values['skill-expertise']));
  const saves = Object.fromEntries(ABILITIES.map((ability) => [ability, modifiers[ability] + (saving.has(ability) ? proficiency : 0)])) as Record<Ability, number>;
  const skills = Object.fromEntries(SKILLS.map(([skill, ability]) => [skill, modifiers[ability] + proficiency * (expert.has(skill) ? 2 : proficient.has(skill) ? 1 : 0)]));
  const spellAbility = values['spell-ability'];
  const casting = typeof spellAbility === 'string' && (ABILITIES as readonly string[]).includes(spellAbility) ? modifiers[spellAbility as Ability] : null;
  return {
    proficiency, modifiers, saves, skills,
    initiative: modifiers.dex + numberOf(values['initiative-bonus'], 0),
    passivePerception: 10 + (skills.perception ?? 0),
    spellSaveDc: casting === null ? null : 8 + proficiency + casting,
    spellAttack: casting === null ? null : proficiency + casting,
  };
}

export const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

/**
 * What Fantasy Statblocks' 5e layout reads beside the sheet's own keys, worked out from it: the
 * saving throws and skills the character is proficient in (FS writes only those), passive
 * Perception among the senses, and the attacks as actions.
 */
function dnd5eStatblockKeys(values: SheetValues): Readonly<Record<string, NoteValue>> {
  const derived = deriveDnd5e(values);
  const saving = listOf(values['save-proficiencies']);
  const skilled = new Set([...listOf(values['skill-proficiencies']), ...listOf(values['skill-expertise'])]);
  const attacks = Array.isArray(values.attacks) ? (values.attacks as readonly SheetRow[]) : [];
  return {
    statblock: true,
    saves: ABILITIES.filter((ability) => saving.includes(ability)).map((ability) => ({ [ability]: derived.saves[ability] })),
    skillsaves: SKILLS.filter(([skill]) => skilled.has(skill)).map(([skill]) => ({ [skill]: derived.skills[skill] ?? 0 })),
    senses: `passive Perception ${derived.passivePerception}`,
    actions: attacks.filter((attack) => String(attack.name ?? '') !== '').map((attack) => ({
      name: String(attack.name),
      desc: [attack.bonus ? `${String(attack.bonus)} to hit` : '', String(attack.damage ?? ''), String(attack.notes ?? '')].filter((part) => part !== '').join(', '),
    })),
  };
}

export const DND5E_2024: SheetSystem<Dnd5eDerived> = {
  id: 'dnd5e-2024',
  name: 'D&D 5e (2024)',
  fields: DND5E_2024_FIELDS,
  derive: deriveDnd5e,
  statblockKeys: dnd5eStatblockKeys,
};
