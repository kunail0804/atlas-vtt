import { describe, expect, it } from 'vitest';
import { isExpressionError } from '../../../../src/app/statblocks/expressions/errors';
import { evaluateFormula } from '../../../../src/app/statblocks/expressions/evaluate';
import { formulaText } from '../../../../src/app/statblocks/expressions/formulaText';
import { parseFormula } from '../../../../src/app/statblocks/expressions/parse';
import { patternRefs } from '../../../../src/app/statblocks/expressions/patternRefs';
import type { FormulaNode } from '../../../../src/app/statblocks/expressions/formulaTypes';
import type { FieldValue } from '../../../../src/app/statblocks/model/templateTypes';

const RECORD: Record<string, FieldValue> = {
  level: 99,
  classes: [{ name: 'Guerrier', level: 3, die: 'd10' }, { name: 'Magicien', level: 2, die: 'd6', caster: 'Complet' }],
};

function parsed(source: string): FormulaNode {
  const node = parseFormula(source);
  if (isExpressionError(node)) throw new Error(node.message);
  return node;
}

function value(source: string, record: Record<string, FieldValue> = RECORD): number | string {
  const result = evaluateFormula(parsed(source), (ref) => record[ref]);
  return result.ok ? result.value : result.error.message;
}

describe('formulas over a list of entries', () => {
  it('sum works the formula out for every entry, with the entry\'s parts', () => {
    expect(value('sum(classes, level)')).toBe(5);
    expect(value('sum(classes, has(caster, "Complet") * level)')).toBe(2);
    expect(value('sum(classes, level * (sides(die) / 2 + 1))')).toBe(26);
  });

  it('first works it out for the first entry', () => {
    expect(value('first(classes, sides(die))')).toBe(10);
  });

  it('an empty list sums to 0 and has no first entry', () => {
    expect(value('sum(classes, level)', { classes: [] })).toBe(0);
    expect(value('first(classes, level)', { classes: [] })).toMatch(/no entry/);
  });

  it('inside an entry a part it lacks is no field of the statblock', () => {
    expect(value('sum(classes, caster_level)')).toMatch(/empty/);
  });

  it('sides reads a die written d10 or 1d10, and nothing else', () => {
    expect(value('sides(die)', { die: '1d12' })).toBe(12);
    expect(value('sides(die)', { die: '2d6' })).toMatch(/isn't a die/);
    expect(value('sides(die)', { die: 8 })).toMatch(/isn't a die/);
  });

  it('a list that is no list of entries is said so', () => {
    expect(value('sum(classes, level)', { classes: 'Guerrier' })).toMatch(/isn't a list/);
  });

  it('writes back to what parses to the same tree', () => {
    const source = 'sum(classes, has(caster, "Demi") * ceil(level / 2)) + first(classes, sides(die))';
    expect(parsed(formulaText(parsed(source)))).toEqual(parsed(source));
  });

  it('reads the list as a field, never the entry\'s parts', () => {
    expect(patternRefs('{=sum(classes, level * sides(die)) + level}')).toEqual(['classes', 'level']);
  });

  it('refuses a call that names no list', () => {
    expect(isExpressionError(parseFormula('sum(1, level)'))).toBe(true);
    expect(isExpressionError(parseFormula('first(classes)'))).toBe(true);
    expect(isExpressionError(parseFormula('sides(1)'))).toBe(true);
  });
});
