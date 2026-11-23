import { describe, expect, it } from 'vitest';
import { parseFormula } from '../../../../src/app/statblocks/expressions/parse';
import { evaluateFormula } from '../../../../src/app/statblocks/expressions/evaluate';
import { isExpressionError } from '../../../../src/app/statblocks/expressions/errors';
import { parsePattern } from '../../../../src/app/statblocks/expressions/patternParse';
import { renderPattern } from '../../../../src/app/statblocks/expressions/pattern';
import type { FormulaNode } from '../../../../src/app/statblocks/expressions/formulaTypes';
import type { TemplateBlock } from '../../../../src/app/statblocks/model/templateTypes';
import { FIVE_E_2014_CHARACTER, FIVE_E_2024_CHARACTER } from '../../../../src/app/statblocks/presets/fiveECharacter';
import { readerFor } from '../../../../src/app/statblocks/values/fieldValues';
import { derivedPatches, derivedValues } from '../../../../src/app/statblocks/values/derivedValues';
import { syncedResources } from '../../../../src/app/resources/statblockResourceSync';
import type { ResourceDefinition } from '../../../../src/app/resources/resourceTypes';
import { meaningsOf } from '../../../../src/app/statblocks/resolve/fieldMeanings';

const template = FIVE_E_2024_CHARACTER.template;

/** A fighter 3 / wizard 2 with 16 Dexterity, proficient in Stealth with expertise in Perception. */
const RECORD = {
  name: 'Lia', statblock: true, 'atlas-template': template.id,
  classes: [{ name: 'Guerrier', level: 3, die: 'd10' }, { name: 'Magicien', level: 2, die: 'd6' }],
  stats: [10, 16, 12, 14, 13, 8], initiative_bonus: 1,
  save_proficiencies: 'Force, Constitution', skill_proficiencies: 'Discrétion', skill_expertise: 'Perception', spell_ability: 'Intelligence',
};

function formula(source: string): FormulaNode {
  const node = parseFormula(source);
  if (isExpressionError(node)) throw new Error(node.message);
  return node;
}

function shown(pattern: string, record: Record<string, unknown>): string {
  const ast = parsePattern(pattern);
  if (isExpressionError(ast)) throw new Error(ast.message);
  const result = renderPattern(ast, readerFor(record, template.fields), { lookups: template.lookups });
  expect(result.problems).toEqual([]);
  return result.text;
}

function statPatterns(blocks: readonly TemplateBlock[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const block of blocks) {
    if ('blocks' in block) for (const [label, pattern] of statPatterns(block.blocks)) found.set(label, pattern);
    if (block.type === 'stat' && block.pattern !== undefined) found.set(block.label ?? block.field, block.pattern);
  }
  return found;
}

type ClassEntry = { name: string; level: number; die: string; caster?: string };
const WIZARD = (level: number): ClassEntry => ({ name: 'Magicien', level, die: 'd6', caster: 'Complet' });
const CLERIC = (level: number): ClassEntry => ({ name: 'Clerc', level, die: 'd8', caster: 'Complet' });
const SORCERER = (level: number): ClassEntry => ({ name: 'Ensorceleur', level, die: 'd6', caster: 'Complet' });
const PALADIN = (level: number): ClassEntry => ({ name: 'Paladin', level, die: 'd10', caster: 'Demi' });
const RANGER = (level: number): ClassEntry => ({ name: 'Rôdeur', level, die: 'd10', caster: 'Demi' });
const WARLOCK = (level: number): ClassEntry => ({ name: 'Occultiste', level, die: 'd8', caster: 'Pacte' });
const FIGHTER = (level: number, caster?: string): ClassEntry => ({ name: 'Guerrier', level, die: 'd10', ...(caster !== undefined && { caster }) });

function sheet(classes: ClassEntry[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Lia', statblock: true, 'atlas-template': template.id, classes, stats: [10, 10, 14, 10, 10, 10], ...extra };
}

/** The rows of spell slots the sheet works out: name and maximum. */
function slots(record: Record<string, unknown>): [string, number][] | undefined {
  const value = derivedValues(template, record).get('spell_slots');
  if (!Array.isArray(value)) return undefined;
  return value.map((row) => {
    const { name, max } = row as { name: string; max: number };
    return [name, max];
  });
}

describe('has() in formulas', () => {
  it('is 1 where a list or a line of picks holds the text, in any case, and 0 for an empty field', () => {
    const read = readerFor({ picks: 'Stealth, Arcana', list: ['a', 'B'] }, []);
    expect(evaluateFormula(formula('has(picks, "stealth") + 2 * has(list, "b")'), read)).toEqual({ ok: true, value: 3 });
    expect(evaluateFormula(formula('has(missing, "x")'), read)).toEqual({ ok: true, value: 0 });
  });

  it('refuses a quoted text anywhere else', () => {
    expect(isExpressionError(parseFormula('1 + "x"'))).toBe(true);
    expect(isExpressionError(parseFormula('has(picks)'))).toBe(true);
  });
});

describe('the 5E character template', () => {
  it('works out class, level, proficiency, initiative, hit dice and hit points from the classes', () => {
    expect(Object.fromEntries(derivedValues(template, RECORD))).toEqual({
      class: 'Guerrier / Magicien', level: 5, proficiency: 3, initiative: 4, hp: 35, hit_dice: '3d10 + 2d6',
    });
    expect(derivedPatches(template, { ...RECORD, class: 'Guerrier / Magicien', level: 5, proficiency: 3, initiative: 4, hp: 35, hit_dice: '3d10 + 2d6' })).toEqual([]);
  });

  it('keeps what was typed where the sheet lists no classes', () => {
    expect(derivedValues(template, { ...RECORD, classes: [], level: 7 }).get('level')).toBeUndefined();
    expect(derivedValues(template, { ...RECORD, classes: [], level: 7 }).get('proficiency')).toBe(3);
  });

  it('adds the proficiency bonus once for a proficiency and twice for an expertise', () => {
    const record = { ...RECORD, ...Object.fromEntries(derivedValues(template, RECORD)) };
    const patterns = statPatterns(template.layout.blocks);
    expect(shown(patterns.get('Discrétion') ?? '', record)).toBe('+6');
    expect(shown(patterns.get('Perception') ?? '', record)).toBe('+7');
    expect(shown(patterns.get('Arcanes') ?? '', record)).toBe('+2');
    expect(shown(patterns.get('Force') ?? '', record)).toBe('+3');
    expect(shown(patterns.get('Dextérité') ?? '', record)).toBe('+3');
    expect(shown(patterns.get('Perception passive') ?? '', record)).toBe('17');
    expect(shown(patterns.get('DD des sorts') ?? '', record)).toBe('13');
  });

  it('is the same sheet under both rule sets but for its words and the hit point bonus the 2024 rules add', () => {
    expect(FIVE_E_2014_CHARACTER.template.fields.map((field) => field.key)).toEqual(template.fields.map((field) => field.key).filter((key) => key !== 'hp_bonus'));
    expect(FIVE_E_2014_CHARACTER.template.fields.find((field) => field.key === 'species')?.label).toBe('Race');
  });
});

describe('spell slots from the classes (2024 rules)', () => {
  it('a wizard 5 alone has the slots of a caster of level 5', () => {
    expect(slots(sheet([WIZARD(5)]))).toEqual([['Niveau 1', 4], ['Niveau 2', 3], ['Niveau 3', 2]]);
  });

  it('a paladin 5 alone counts half its level rounded up, as its own table does', () => {
    expect(slots(sheet([PALADIN(5)]))).toEqual([['Niveau 1', 4], ['Niveau 2', 2]]);
    expect(slots(sheet([PALADIN(1)]))).toEqual([['Niveau 1', 2]]);
  });

  it('a wizard 3 / cleric 1 / fighter 2 is a caster of level 4', () => {
    expect(slots(sheet([WIZARD(3), CLERIC(1), FIGHTER(2)]))).toEqual([['Niveau 1', 4], ['Niveau 2', 3]]);
  });

  it('a paladin 3 / ranger 3 rounds each half caster up: 2 + 2 = 4', () => {
    expect(slots(sheet([PALADIN(3), RANGER(3)]))).toEqual([['Niveau 1', 4], ['Niveau 2', 3]]);
  });

  it('a warlock 3 / sorcerer 2 has the slots of a caster of level 2 and keeps its Pact Magic row', () => {
    const pact = { name: 'Pacte', max: 2, used: 1 };
    const value = derivedValues(template, sheet([WARLOCK(3), SORCERER(2)], { spell_slots: [pact] })).get('spell_slots');
    expect(value).toEqual([{ name: 'Niveau 1', max: 3 }, pact]);
  });

  it('a warlock alone keeps the slots typed in its sheet', () => {
    expect(derivedValues(template, sheet([WARLOCK(5)], { spell_slots: [{ name: 'Pacte', max: 2 }] })).has('spell_slots')).toBe(false);
  });

  it('a third caster rounds up alone and down beside another caster', () => {
    expect(slots(sheet([FIGHTER(7, 'Tiers')]))).toEqual([['Niveau 1', 4], ['Niveau 2', 2]]);
    expect(slots(sheet([FIGHTER(7, 'Tiers'), WIZARD(1)]))).toEqual([['Niveau 1', 4], ['Niveau 2', 2]]);
    expect(slots(sheet([FIGHTER(5, 'Tiers'), WIZARD(1)]))).toEqual([['Niveau 1', 3]]);
  });

  it('a character without a caster class keeps what its sheet holds', () => {
    expect(derivedValues(template, sheet([FIGHTER(5)])).has('spell_slots')).toBe(false);
  });

  it('slots spent stay spent when the level goes up, and come down to a lower maximum', () => {
    const spent = [{ name: 'Niveau 1', max: 4, used: 3, reset: 'long' }, { name: 'Niveau 2', max: 3, used: 3 }];
    expect(derivedValues(template, sheet([WIZARD(5)], { spell_slots: spent })).get('spell_slots')).toEqual([
      { name: 'Niveau 1', max: 4, used: 3, reset: 'long' }, { name: 'Niveau 2', max: 3, used: 3 }, { name: 'Niveau 3', max: 2 },
    ]);
    expect(derivedValues(template, sheet([WIZARD(1)], { spell_slots: spent })).get('spell_slots')).toEqual([
      { name: 'Niveau 1', max: 2, used: 2, reset: 'long' },
    ]);
  });

  it('a sheet that holds what its classes give is not written again', () => {
    const record = sheet([WIZARD(3), CLERIC(1)]);
    const written = Object.fromEntries(derivedValues(template, record));
    expect(derivedPatches(template, { ...record, ...written })).toEqual([]);
  });

  it('the 2014 sheet works out neither', () => {
    const values = derivedValues(FIVE_E_2014_CHARACTER.template, sheet([WIZARD(5)], { hp: 30 }));
    expect(values.has('spell_slots')).toBe(false);
    expect(values.has('hp')).toBe(false);
  });
});

describe('hit point maximum from the classes (2024 rules)', () => {
  it('a fighter 1 / wizard 4: the first die at its highest, the fixed value after, and Constitution for every level', () => {
    // 10 + 2, then 4 × (4 + 2).
    expect(derivedValues(template, sheet([FIGHTER(1), WIZARD(4)])).get('hp')).toBe(36);
    // Constitution 16: 10 + 3, then 4 × (4 + 3).
    expect(derivedValues(template, sheet([FIGHTER(1), WIZARD(4)], { stats: [10, 10, 16, 10, 10, 10] })).get('hp')).toBe(41);
  });

  it('the first class of the list gives its die at its highest', () => {
    expect(derivedValues(template, sheet([WIZARD(4), FIGHTER(1)])).get('hp')).toBe(6 + 2 + 3 * (4 + 2) + 6 + 2);
  });

  it('a sheet without classes or a die keeps the hit points typed in it', () => {
    expect(derivedValues(template, sheet([], { hp: 12 })).has('hp')).toBe(false);
    expect(derivedValues(template, sheet([{ name: 'Guerrier', level: 2, die: '' }], { hp: 12 })).has('hp')).toBe(false);
  });

  it("a linked token's current hit points are neither filled nor emptied when the maximum changes", () => {
    const hp: ResourceDefinition = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#ff0000', visibleToPlayers: true };
    const meanings = meaningsOf(template.fields);
    const token = { resources: { hp: { current: 20, max: 36 } } };
    const up = sheet([FIGHTER(1), WIZARD(4)], { stats: [10, 10, 16, 10, 10, 10] });
    expect(syncedResources(token, { ...up, hp: derivedValues(template, up).get('hp') }, [hp], meanings).hp).toEqual({ current: 20, max: 41 });
    const down = sheet([FIGHTER(1), WIZARD(1)]);
    expect(syncedResources(token, { ...down, hp: derivedValues(template, down).get('hp') }, [hp], meanings).hp).toEqual({ current: 18, max: 18 });
  });

  it('adds the bonus the player writes, which the formula never writes over (a dwarf fighter 3, Constitution 14)', () => {
    // 10 + 2, then 2 × (6 + 2), then Dwarven Toughness.
    const dwarf = sheet([FIGHTER(3)], { hp_bonus: 3, hp: 31 });
    expect(derivedValues(template, dwarf).get('hp')).toBe(31);
    expect(derivedPatches(template, dwarf).filter((patch) => patch.path[0] === 'hp')).toEqual([]);
    expect(derivedValues(template, sheet([FIGHTER(3)])).get('hp')).toBe(28);
  });

  it('gives every level at least 1 hit point (a wizard 20 with Constitution 1)', () => {
    expect(derivedValues(template, sheet([WIZARD(20)], { stats: [10, 10, 1, 10, 10, 10] })).get('hp')).toBe(20);
    // A fighter 1 / wizard 2 with Constitution 3 (−4): 10 − 4 = 6 for the first level, 4 − 4 → 1 for each wizard level.
    expect(derivedValues(template, sheet([FIGHTER(1), WIZARD(2)], { stats: [10, 10, 3, 10, 10, 10] })).get('hp')).toBe(8);
  });

  it('a class of level 0 first in the list is not the first class', () => {
    expect(derivedValues(template, sheet([FIGHTER(0), WIZARD(3)])).get('hp')).toBe(6 + 2 + 2 * (4 + 2));
  });
});

describe('the hit point bonus field', () => {
  it('is on the 2024 sheet only', () => {
    expect(template.fields.some((field) => field.key === 'hp_bonus')).toBe(true);
    expect(FIVE_E_2014_CHARACTER.template.fields.some((field) => field.key === 'hp_bonus')).toBe(false);
  });
});
