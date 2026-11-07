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
  it('works out class, level, proficiency, initiative and hit dice from the classes', () => {
    expect(Object.fromEntries(derivedValues(template, RECORD))).toEqual({
      class: 'Guerrier / Magicien', level: 5, proficiency: 3, initiative: 4, hit_dice: '3d10 + 2d6',
    });
    expect(derivedPatches(template, { ...RECORD, class: 'Guerrier / Magicien', level: 5, proficiency: 3, initiative: 4, hit_dice: '3d10 + 2d6' })).toEqual([]);
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

  it('is the same sheet under both rule sets but for its words', () => {
    expect(FIVE_E_2014_CHARACTER.template.fields.map((field) => field.key)).toEqual(template.fields.map((field) => field.key));
    expect(FIVE_E_2014_CHARACTER.template.fields.find((field) => field.key === 'species')?.label).toBe('Race');
  });
});
