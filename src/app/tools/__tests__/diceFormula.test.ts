import { describe, expect, it, vi } from 'vitest';
import { FORMULA_LIMITS, parseFormula, type DiceTerm, type ParsedFormula } from '../parseFormula';
import { MAX_EXPLOSIONS } from '../diceExplosion';
import { EventEmitter } from 'events';
import { rollTestFormula as rollFormula } from './rollTestFormula';
import { DiceTool, rollDiceFormula, type DiceRollInputs } from '../DiceTool';
import { DEFAULT_DICE_RULES } from '../../gameSystems/diceRules';
import { getDiceCrit } from '../diceCrit';
import type { RolledDie } from '../diceFormula';
import type { DiceRules } from '../../types/diceRulesTypes';
import { BUILT_IN_DICE_SETS, D20_DICE_SET_ID } from '../../gameSystems/builtInDiceSets';
import { namedDiceLine, rollLine, diceList, diceSum, dieLabel, dieStates } from '../diceLabels';
import { formulaWithNamedTerms, keptModifiersText, labelledConstant, modifierSteps, modifiersText, namedModifiersOf, plainModifier, withoutConstantLabels } from '../namedModifiers';

function parsed(formula: string): ParsedFormula {
  const result = parseFormula(formula);
  if (!result.ok) throw new Error(`${formula}: ${result.code}`);
  return result;
}

/** The first dice term of `formula`. */
function dice(formula: string): DiceTerm {
  const term = parsed(formula).terms.find((entry): entry is DiceTerm => entry.kind === 'dice');
  if (!term) throw new Error(`${formula} rolls no dice`);
  return term;
}

/** A random source that makes dice of `sides` show `faces`, one after the other. */
function showing(sides: number, ...faces: number[]): () => number {
  let i = 0;
  return (): number => (faces[i++ % faces.length]! - 0.5) / sides;
}

/** A random source that makes Fate dice show `faces` (−1, 0 or +1), one after the other. */
const fate = (...faces: number[]): (() => number) => showing(3, ...faces.map((face) => face + 2));

/** Each die as its value with its marks, for short expectations. */
const shown = (rolls: readonly RolledDie[]): string[] => rolls.map((die) =>
  `${die.value}${die.rerolled ? 'r' : ''}${die.dropped ? 'd' : ''}${die.exploded ? '!' : ''}${die.success ? 's' : ''}${die.failure ? 'f' : ''}`);

const D20: DiceRules = { defaultRoll: '1d20', crit: 'natural' };

const d = (sides: number, value: number, more: Partial<RolledDie> = {}): RolledDie => ({ die: `d${sides}`, value, max: sides, ...more });
const dF = (value: number): RolledDie => ({ die: 'dF', value, max: 1, min: -1 });

it('parseFormula', () => {
  // accepts bounded formulas
  {
    for (const formula of [
      'd20', '+3', '-2D6 + 9999', '0d2', '100d1000', '50d6+50d8', 'd6!!i', 'd6!99', 'd6!0', ' \td20\t ', Array(20).fill('1').join('+'),
      `d20${' '.repeat(97)}`, 'd20*2', '(d20)', 'd%', '4dF', 'dF', '2d6*(1d4+2)/3', '((((((((1d6))))))))', '-(1d6+2)',
      '4d6kh3', '4d6k', '4d6kl1', '4d6d1', '4d6dl', '4d6dh2', '2d20kh1+5', '4d6r1kh3', '4d6ro<2', '4d6rr1', '2d10r>=9',
      '8d10x>=10cs>=8', '3d6x', '3d6xo', '3d6x>5', '5d10>=8', '5d10<=2', '5d10cf<3', '6d6cs=6', '2d6[fire]', '3[bonus]', "1d8[Sneak Attack]+1d6[it's cold]",
    ]) {
      expect(parseFormula(formula).ok).toBe(true);
    }
  }

  // rejects malformed formulas
  {
    for (const formula of [
      '', ' ', 'hello d20', 'd20 hello', 'd20+garbage+d6', 'd20 d6', 'd20++2', 'd20-', 'd20\n', 'd20\r', 'd20 ', '1.5d6', 'd6!!!', 'd6!100',
      'd6!I', '10000', '00001', '0001d6', 'd00006', 'Infinity', '()', '(d20', 'd20)', '2*-3', 'd20*', '4d6 kh3', '2d6 [fire]', '4d6>3', '4d6<3',
      '4d6=3', '4d6cs', '4d6kh3r1', '4d6kh1kh1', '4d6!x', '4d6x6', '2d6[]', '2d6[fire!]', `2d6[${'a'.repeat(25)}]`, '1d6/0', '1d6/(0)', '4d6KH3',
      '(1d6)[fire]', 'd20 / 0',
    ]) {
      expect(parseFormula(formula)).toEqual({ ok: false, code: 'syntax' });
    }
  }

  // rejects formulas over a budget with the budget they break
  {
    for (const [formula, code] of [
      [`d20${' '.repeat(98)}`, 'length'],
      [Array(21).fill('1').join('+'), 'terms'],
      ['101d6', 'dice'],
      ['50d6-51d8', 'dice'],
      ['d1001', 'faces'],
      ['d1+2', 'faces'],
      ['d0', 'faces'],
      ['(((((((((1d6)))))))))', 'depth'],
      ['2d6kh3', 'modifier'],
      ['2d6d3', 'modifier'],
      ['2d6kh0', 'modifier'],
      ['0d6kh1', 'modifier'],
      ['d6x>=1', 'modifier'],
      ['d6x>0', 'modifier'],
      ['d6r<7', 'modifier'],
      ['d6rr>=1', 'modifier'],
      ['4dF!', 'modifier'],
      ['4dFr1', 'modifier'],
      ['100d1000*9999', 'total'],
      ['1d6/(1/9999)*9999*9999', 'total'],
    ] as const) {
      expect(parseFormula(formula)).toEqual({ ok: false, code });
    }
  }

  // reads d% as a d100 and dF as Fate dice
  {
    expect(dice('d%')).toMatchObject({ count: 1, faces: 100 });
    expect(dice('4dF')).toMatchObject({ count: 4, faces: 1, fate: true });
  }

  // reads keep and drop with their defaults
  {
    expect(dice('4d6k').keep).toEqual({ mode: 'keep', end: 'highest', count: 1 });
    expect(dice('4d6kh3').keep).toEqual({ mode: 'keep', end: 'highest', count: 3 });
    expect(dice('4d6kl2').keep).toEqual({ mode: 'keep', end: 'lowest', count: 2 });
    expect(dice('4d6d').keep).toEqual({ mode: 'drop', end: 'lowest', count: 1 });
    expect(dice('4d6dh2').keep).toEqual({ mode: 'drop', end: 'highest', count: 2 });
  }

  // reads rerolls: once, or again and again
  {
    expect(dice('2d6r').reroll).toEqual({ when: { operator: '=', value: 1 }, limit: 1 });
    expect(dice('2d6r2').reroll).toEqual({ when: { operator: '=', value: 2 }, limit: 1 });
    expect(dice('2d6ro<=2').reroll).toEqual({ when: { operator: '<=', value: 2 }, limit: 1 });
    expect(dice('2d6rr<3').reroll).toEqual({ when: { operator: '<', value: 3 }, limit: MAX_EXPLOSIONS });
  }

  // reads Foundry's explosions next to Dice Roller's
  {
    expect(dice('3d6!').explode).toEqual({ highFaces: 1, lowFaces: 0, limit: 1 });
    expect(dice('3d6x').explode).toEqual({ highFaces: 1, lowFaces: 0, limit: MAX_EXPLOSIONS });
    expect(dice('3d6xo').explode).toEqual({ highFaces: 1, lowFaces: 0, limit: 1 });
    expect(dice('3d10x>=9').explode).toEqual({ highFaces: 2, lowFaces: 0, limit: MAX_EXPLOSIONS });
    expect(dice('3d10xo>8').explode).toEqual({ highFaces: 2, lowFaces: 0, limit: 1 });
  }

  // reads counting: bare >= counts successes, bare <= failures
  {
    expect(dice('5d10cs>=8').tally).toEqual({ counts: 'successes', when: { operator: '>=', value: 8 } });
    expect(dice('5d10>=8').tally).toEqual({ counts: 'successes', when: { operator: '>=', value: 8 } });
    expect(dice('5d10cf<2').tally).toEqual({ counts: 'failures', when: { operator: '<', value: 2 } });
    expect(dice('5d10<=2').tally).toEqual({ counts: 'failures', when: { operator: '<=', value: 2 } });
  }

  // reads labels on dice and constants
  {
    expect(dice('2d6x[fire]')).toMatchObject({ label: 'fire' });
    expect(parsed('1d20+3[bonus]').terms[1]).toEqual({ kind: 'constant', value: 3, negative: false, label: 'bonus' });
  }

  // marks every term an odd number of minus signs leads to
  {
    const negatives = (formula: string): boolean[] => parsed(formula).terms.map((term) => term.negative);
    expect(negatives('-2D6 + 9999')).toEqual([true, false]);
    expect(negatives('2d6-1d4-(1d8-3)')).toEqual([false, true, true, false]);
    expect(negatives('2*(1d6-1d4)')).toEqual([false, false, true]);
  }

  // tells a plain sum from a formula that multiplies, divides or counts
  {
    expect(parsed('2d20kh1+5-1d4').linear).toBe(true);
    expect(parsed('-(1d6+2)').linear).toBe(true);
    expect(parsed('2d6*2').linear).toBe(false);
    expect(parsed('2d6/2').linear).toBe(false);
    expect(parsed('5d10>=8+1').linear).toBe(false);
  }

  // keeps the limits it promises
  {
    expect(FORMULA_LIMITS).toMatchObject({ characters: 100, terms: 20, dice: 100, faces: 1000, depth: 8 });
  }
});

describe('rolling a formula', () => {
  const inputs = { random: Math.random, rollId: (): string => 'test-roll', roller: (): string => 'Player', onFormulaError: (): void => {} };

  /** Rolls every die at its highest face. */
  const highest = (): number => 0.999;

  /** Rolls the faces given, in turn, on dice of the sides given. */
  const faces = (...rolled: Array<[number, number]>) => {
    const queue = [...rolled];
    return (): number => {
      const [face, sides] = queue.shift() ?? [1, 2];
      return (face - 0.5) / sides;
    };
  };

  it('keeping dice', () => {
    // keeps the highest or lowest, marking the others dropped and leaving them out of the total
    {
      const high = rollFormula('2d20kh1+2', faces([5, 20], [14, 20]));
      expect(high.rolls).toEqual([{ die: 'd20', value: 5, max: 20, dropped: true }, { die: 'd20', value: 14, max: 20 }]);
      expect(high.total).toBe(16);
      const low = rollFormula('4d6kl3', faces([6, 6], [2, 6], [3, 6], [5, 6]));
      expect(low.rolls.map((die) => die.dropped === true)).toEqual([true, false, false, false]);
      expect(low.total).toBe(10);
    }

    // keeps the earlier of equal dice
    {
      const tie = rollFormula('2d20kh1', faces([9, 20], [9, 20]));
      expect(tie.rolls.map((die) => die.dropped === true)).toEqual([false, true]);
    }

    // keeps a subtracted term's best die and subtracts it
    {
      expect(rollFormula('10-2d6kh1', faces([2, 6], [5, 6])).total).toBe(5);
    }
  });

  it('rollFormula', () => {
    // reads a signed dice term as dice, not as a modifier
    {
      const result = rollFormula('d20+2d6', highest);
      expect(result.rolls.map((r) => r.die)).toEqual(['d20', 'd6', 'd6']);
      expect(result.modifiers).toBe(0);
      expect(result.total).toBe(32);
    }

    // subtracts dice of a minus term
    {
      const result = rollFormula('2d6-1d4', highest);
      expect(result.rolls[2]).toEqual({ die: 'd4', value: 4, max: 4, negative: true });
      expect(result.total).toBe(8);
    }

    // adds constants as modifiers
    {
      const result = rollFormula('1d8 + 1d6 + 3 - 1', highest);
      expect(result.modifiers).toBe(2);
      expect(result.total).toBe(16);
    }

    // rolls nothing for text without dice
    {
      expect(rollFormula('+3').rolls).toEqual([]);
      expect(parseFormula('d1+2')).toEqual({ ok: false, code: 'faces' });
    }
  });

  it('DiceTool bare bonuses', () => {
    // adds a bare bonus to the collection default roll and records its crit
    {
      const tool = new DiceTool(new EventEmitter(), () => ({ defaultRoll: '2d12', crit: 'doubles' }), inputs);
      const result = tool.rollDice('+3')!;
      expect(result.formula).toBe('2d12+3');
      expect(result.rolls.map((r) => r.die)).toEqual(['d12', 'd12']);
      expect(result.crit === 'high').toBe(result.rolls[0]!.value === result.rolls[1]!.value);
    }

    // reads a bare number as a bonus
    {
      expect(new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, inputs).rollDice('4')?.formula).toBe('1d20+4');
      expect(new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, inputs).rollDice('-1')?.formula).toBe('1d20-1');
    }
  });
});

it('keep and drop', () => {
  // keeps the highest dice and leaves the others out of the total
  {
    const result = rollFormula('4d6kh3', showing(6, 3, 1, 6, 4));
    expect(shown(result.rolls)).toEqual(['3', '1d', '6', '4']);
    expect(result.total).toBe(13);
    expect(result).toMatchObject({ modifiers: 0, linear: true });
  }

  // drops the lowest by default, and keeps or drops either end
  {
    expect(rollFormula('4d6d', showing(6, 3, 1, 6, 4)).total).toBe(13);
    expect(rollFormula('4d6dh1', showing(6, 3, 1, 6, 4)).total).toBe(8);
    expect(rollFormula('4d6kl2', showing(6, 3, 1, 6, 4)).total).toBe(4);
    expect(rollFormula('2d20kh1+5', showing(20, 7, 15)).total).toBe(20);
  }

  // keeps the earlier of equal dice
  {
    expect(shown(rollFormula('2d20kh1', showing(20, 15, 15)).rolls)).toEqual(['15', '15d']);
    expect(shown(rollFormula('3d6dl1', showing(6, 2, 2, 5)).rolls)).toEqual(['2d', '2', '5']);
  }

  // ranks the dice an explosion added like any other
  {
    const result = rollFormula('2d6xkh1', showing(6, 6, 5, 3));
    expect(shown(result.rolls)).toEqual(['6', '5d!', '3d']);
    expect(result.total).toBe(6);
  }

  // lets only kept default dice decide a critical
  {
    expect(getDiceCrit(rollFormula('2d20kh1', showing(20, 3, 20)).rolls, D20)).toBe('high');
    expect(getDiceCrit(rollFormula('2d20kh1', showing(20, 20, 3)).rolls, D20)).toBe('high');
    expect(getDiceCrit(rollFormula('2d20kl1', showing(20, 20, 3)).rolls, D20)).toBeNull();
    expect(getDiceCrit(rollFormula('2d20kl1', showing(20, 1, 20)).rolls, D20)).toBe('low');
  }
});

it('rerolls', () => {
  // rolls a die again once, and the new die stands even when it matches
  {
    const result = rollFormula('2d6r1', showing(6, 1, 1, 5));
    expect(shown(result.rolls)).toEqual(['1r', '1', '5']);
    expect(result.total).toBe(6);
  }

  // reads ro as r, and rolls again with rr until the die no longer matches
  {
    expect(shown(rollFormula('1d6ro<3', showing(6, 2, 1)).rolls)).toEqual(['2r', '1']);
    expect(shown(rollFormula('1d6rr<3', showing(6, 2, 1, 4)).rolls)).toEqual(['2r', '1r', '4']);
  }

  // rolls again at most MAX_EXPLOSIONS times
  {
    const result = rollFormula('1d6rr1', showing(6, 1));
    expect(result.rolls).toHaveLength(MAX_EXPLOSIONS + 1);
    expect(result.rolls.filter((die) => die.rerolled)).toHaveLength(MAX_EXPLOSIONS);
    expect(result.total).toBe(1);
  }

  // rolls again before keeping, and a rerolled die never counts for a critical
  {
    const result = rollFormula('4d6r1kh3', showing(6, 1, 2, 3, 4, 5));
    expect(shown(result.rolls)).toEqual(['1r', '2d', '3', '4', '5']);
    expect(result.total).toBe(12);
    expect(getDiceCrit(rollFormula('1d20r1', showing(20, 1, 12)).rolls, D20)).toBeNull();
  }
});

it("Foundry's explosions", () => {
  // explodes again and again with x, once with xo
  {
    expect(rollFormula('1d6x', showing(6, 6, 6, 2)).total).toBe(14);
    expect(shown(rollFormula('1d6xo', showing(6, 6, 6)).rolls)).toEqual(['6', '6!']);
  }

  // explodes from a face up with x>= and x>
  {
    expect(shown(rollFormula('1d6x>=5', showing(6, 5, 6, 1)).rolls)).toEqual(['5', '6!', '1!']);
    expect(shown(rollFormula('1d6x>4', showing(6, 5, 2)).rolls)).toEqual(['5', '2!']);
  }

  // keeps Dice Roller notation as it was
  {
    expect(rollFormula('1d6!', showing(6, 6, 6)).rolls).toHaveLength(2);
    expect(rollFormula('1d6!i', showing(6, 6)).rolls).toHaveLength(1 + MAX_EXPLOSIONS);
  }
});

it('counting dice', () => {
  // counts successes, each die an explosion added included
  {
    const result = rollFormula('4d10x>=10cs>=8', showing(10, 10, 9, 3, 8, 1));
    expect(shown(result.rolls)).toEqual(['10s', '9!s', '3', '8s', '1']);
    expect(result.total).toBe(3);
    expect(result).toMatchObject({ modifiers: 0, linear: false });
  }

  // counts with bare >= and every comparison
  {
    expect(rollFormula('5d10>=8', showing(10, 8, 7, 10, 1, 9)).total).toBe(3);
    expect(rollFormula('5d10cs>7', showing(10, 8, 7, 10, 1, 9)).total).toBe(3);
    expect(rollFormula('5d10cs=10', showing(10, 8, 7, 10, 1, 9)).total).toBe(1);
    expect(rollFormula('5d10cs<2', showing(10, 8, 7, 10, 1, 9)).total).toBe(1);
  }

  // counts failures with cf and bare <=
  {
    const result = rollFormula('4d6<=2', showing(6, 1, 2, 5, 6));
    expect(shown(result.rolls)).toEqual(['1f', '2f', '5', '6']);
    expect(result.total).toBe(2);
    expect(rollFormula('4d6cf<2', showing(6, 1, 2, 5, 6)).total).toBe(1);
  }

  // counts only the dice that were kept, and adds counts like numbers
  {
    expect(rollFormula('4d6kh2>=5', showing(6, 6, 5, 5, 1)).total).toBe(2);
    expect(rollFormula('3d6>=5+1', showing(6, 6, 5, 1)).total).toBe(3);
    expect(rollFormula('-3d6>=5', showing(6, 6, 5, 1)).total).toBe(-2);
  }
});

it('arithmetic', () => {
  // multiplies and divides before it adds, and follows parentheses
  {
    expect(rollFormula('2+3*4').total).toBe(14);
    expect(rollFormula('(2+3)*4').total).toBe(20);
    expect(rollFormula('20-2*3-4').total).toBe(10);
    expect(rollFormula('-(2+3)*2').total).toBe(-10);
    expect(rollFormula('2*(1d6+1)', showing(6, 4)).total).toBe(10);
  }

  // keeps fractions until the end and cuts the total towards zero
  {
    expect(rollFormula('7/2').total).toBe(3);
    expect(rollFormula('-7/2').total).toBe(-3);
    expect(rollFormula('7/3*3').total).toBe(7);
    expect(rollFormula('1d6/2', showing(6, 5)).total).toBe(2);
    expect(rollFormula('1/3+1/3+1/3').total).toBe(1);
  }

  // makes a quotient 0 when its divisor comes out 0
  {
    expect(rollFormula('10/(1d4-1d4)', showing(4, 3, 3)).total).toBe(0);
  }

  // keeps the modifier of a plain sum, and none for a formula that is no sum
  {
    expect(rollFormula('1d20+5-2', showing(20, 10))).toMatchObject({ modifiers: 3, total: 13, linear: true });
    expect(rollFormula('-(1d6+2)', showing(6, 4))).toMatchObject({ modifiers: -2, total: -6, linear: true });
    expect(rollFormula('1d6*2+3', showing(6, 4))).toMatchObject({ modifiers: 0, total: 11, linear: false });
  }
});

it('dice kinds and labels', () => {
  // rolls Fate dice with faces −1, 0 and +1
  {
    const result = rollFormula('4dF', fate(-1, 0, 1, 1));
    expect(result.rolls[0]).toEqual({ die: 'dF', value: -1, max: 1, min: -1 });
    expect(result.rolls.map((die) => die.value)).toEqual([-1, 0, 1, 1]);
    expect(result.total).toBe(1);
    expect(rollFormula('2-2dF', fate(1, 1)).total).toBe(0);
  }

  // keeps and counts Fate dice
  {
    expect(rollFormula('4dFkh2', fate(-1, 1, 0, 1)).total).toBe(2);
    expect(rollFormula('4dF>=1', fate(-1, 1, 0, 1)).total).toBe(2);
  }

  // rolls d% as a d100
  {
    expect(rollFormula('d%', showing(100, 42)).rolls).toEqual([{ die: 'd100', value: 42, max: 100 }]);
  }

  // labels every die of a labelled term, explosions included
  {
    const result = rollFormula('1d6x[fire]+1d4+2[bonus]', showing(6, 6, 2, 3));
    expect(result.rolls.map((die) => die.label)).toEqual(['fire', 'fire', undefined]);
    expect(result.modifiers).toBe(2);
  }

  // still lets the collection rule count a default die that explodes by its own notation
  {
    const rules = { defaultRoll: '1d10', explode: { dice: 'default' as const, repeats: false, highFaces: 1, lowFaces: 0 } };
    expect(rollFormula('1d10!0+1d10', showing(10, 10, 10, 10), rules).rolls).toHaveLength(2);
  }
});

describe('modifiers with labels', () => {
  function inputs(random: () => number): DiceRollInputs {
    return { random, rollId: () => 'roll', roller: () => 'GM', onFormulaError: vi.fn() };
  }

  describe('labelled constants', () => {
    it('stay apart from the other constants, and still count in modifiers and the total', () => {
      const result = rollFormula('1d20+3+2[Proficiency]-1[Bane]', showing(20, 12));
      expect(result).toMatchObject({ modifiers: 4, total: 16, linear: true });
      expect(result.named).toEqual([{ label: 'Proficiency', value: 2 }, { label: 'Bane', value: -1 }]);
    });

    it('are no modifiers of a formula that is no plain sum', () => {
      const result = rollFormula('1d6*2+2[Proficiency]', showing(6, 4));
      expect(result).toMatchObject({ modifiers: 0, named: [], total: 10, linear: false });
    });

    it('reach the roll as named modifiers, only where there are some', () => {
      const named = rollDiceFormula('+3+2[Stealth]', DEFAULT_DICE_RULES, inputs(showing(20, 20)));
      expect(named).toMatchObject({ formula: '1d20+3+2[Stealth]', modifiers: 5, total: 25, crit: 'high' });
      expect(named?.namedModifiers).toEqual([{ label: 'Stealth', value: 2 }]);
      expect(rollDiceFormula('1d20+3', DEFAULT_DICE_RULES, inputs(showing(20, 5)))).not.toHaveProperty('namedModifiers');
    });

    it('keep the crit on the dice and advantage on the set\'s die', () => {
      const d20 = BUILT_IN_DICE_SETS.find((set) => set.id === D20_DICE_SET_ID)!;
      const result = rollDiceFormula('+1+2[Proficiency]', d20, inputs(showing(20, 1, 20)), undefined, 'advantage');
      expect(result).toMatchObject({ advantage: 'advantage', total: 23, crit: 'high', modifiers: 3 });
      expect(result?.rolls.map((die) => die.dropped ?? false)).toEqual([true, false]);
    });
  });

  describe('how a roll writes its modifiers', () => {
    const roll = { formula: '1d20+3+2[Stealth]', modifiers: 5, namedModifiers: [{ label: 'Stealth', value: 2 }], rolls: [] };

    it('names each labelled one after the plain sum, a subtracted one with a minus sign', () => {
      expect(plainModifier(roll)).toBe(3);
      expect(modifiersText(roll)).toBe(' + 3 + 2 Stealth');
      expect(modifiersText({ modifiers: -1, namedModifiers: [{ label: 'Bane', value: -1 }] })).toBe(' − 1 Bane');
      expect(modifiersText({ modifiers: 0, namedModifiers: [{ label: 'Luck', value: 0 }] })).toBe(' + 0 Luck');
      expect(modifiersText({ modifiers: 3 })).toBe(' + 3');
    });

    it('breaks a line only before a labelled term\'s sign', () => {
      expect(keptModifiersText(roll)).toBe(' + 3 + 2 Stealth');
    });

    it('rewrites the formula\'s labelled constants as terms of their own', () => {
      expect(formulaWithNamedTerms(roll)).toBe('1d20+3 +\u00a02\u00a0Stealth');
      expect(rollLine(roll)).toBe('1d20+3 +\u00a02\u00a0Stealth');
      // Dice labels are no constants.
      expect(formulaWithNamedTerms({ ...roll, formula: '2d6[fire]+2[Stealth]' })).toBe('2d6[fire] +\u00a02\u00a0Stealth');
    });

    it('keeps the formula where it does not end in the roll\'s labelled constants', () => {
      expect(formulaWithNamedTerms({ ...roll, formula: '1d20+5' })).toBe('1d20+5');
      expect(formulaWithNamedTerms({ ...roll, formula: '1d20+2[Stealth]+3' })).toBe('1d20+2[Stealth]+3');
    });

    it('writes a labelled constant as a formula holds it', () => {
      expect([labelledConstant({ label: 'Stealth', value: 2 }), labelledConstant({ label: 'Bane', value: -1 }), labelledConstant({ label: '', value: 3 })])
        .toEqual(['+2[Stealth]', '-1[Bane]', '+3']);
    });

    it('clicks in the plain modifier, then each labelled one', () => {
      expect(modifierSteps(roll, 'Modifier')).toEqual([{ label: 'Modifier', value: 3 }, { label: 'Stealth', value: 2 }]);
      expect(modifierSteps({ modifiers: 0, namedModifiers: [{ label: 'Luck', value: 0 }] }, 'Modifier')).toEqual([{ label: 'Luck', value: 0 }]);
      expect(modifierSteps({ modifiers: 5 }, 'Modifier')).toEqual([{ label: 'Modifier', value: 5 }]);
    });

    it('names the labelled ones after dice a set named', () => {
      const rolls = [{ value: 9, name: 'Hope' }, { value: 4, name: 'Fear' }];
      expect(namedDiceLine(rolls, { modifiers: 3, namedModifiers: [{ label: 'Survival', value: 2 }] }))
        .toBe('Hope 9 · Fear 4 + 1 + 2 Survival');
    });

    it('reads a saved log of an older version, and leaves out entries it cannot read', () => {
      expect(namedModifiersOf({ modifiers: 2 })).toEqual([]);
      const damaged = { modifiers: 4, namedModifiers: [{ label: 'Ok', value: 1 }, { label: '', value: 2 }, { label: 'NaN', value: Number.NaN }, null] };
      expect(namedModifiersOf(damaged as never)).toEqual([{ label: 'Ok', value: 1 }]);
      expect(modifiersText(damaged as never)).toBe(' + 3 + 1 Ok');
    });
  });

  describe('a formula without the labels of its constants', () => {
    it('drops a constant\'s label and keeps a label of dice', () => {
      expect(withoutConstantLabels('2[Agi]+1d20+3[Str mod]-1[Bane]')).toBe('2+1d20+3-1');
      expect(withoutConstantLabels('2d6[fire]+1d20cs>=8[hits]+(4[Prof])')).toBe('2d6[fire]+1d20cs>=8[hits]+(4)');
    });
  });
});

it('diceSum', () => {
  // writes old rolls as before
  {
    expect(diceSum([d(6, 6), d(6, 6, { exploded: true }), d(6, 2, { exploded: true }), d(6, 3)])).toBe('6! + 6! + 2 + 3');
    expect(diceSum([d(10, 1), d(10, 7, { exploded: true, negative: true })])).toBe('1! − 7');
  }

  // puts dropped dice in parentheses and joins a rerolled die to the die after it
  {
    expect(diceSum(rollFormula('4d6kh3', showing(6, 3, 1, 6, 4)).rolls)).toBe('3 + (1) + 6 + 4');
    expect(diceSum(rollFormula('2d6r1', showing(6, 1, 5, 4)).rolls)).toBe('1→5 + 4');
    expect(diceSum(rollFormula('1d6-1d6rr1', showing(6, 3, 1, 1, 2)).rolls)).toBe('3 − 1→1→2');
  }

  // adds Fate dice by their numbers
  {
    expect(diceSum([dF(1), dF(0), dF(-1), dF(1)])).toBe('1 + 0 − 1 + 1');
    expect(diceSum([dF(-1), dF(1)])).toBe('−1 + 1');
  }

  // names a labelled run of dice once, after its last die
  {
    expect(diceSum(rollFormula('2d4[fire]+1d4[cold]+1d4', showing(4, 4, 3, 2, 1)).rolls)).toBe('4 + 3 [fire] + 2 [cold] + 1');
  }
});

describe('diceList', () => {
  it('lists the dice of a formula that is no sum, with their marks', () => {
    expect(diceList(rollFormula('4d10x>=10cs>=8', showing(10, 10, 9, 3, 8, 1)).rolls)).toBe('10!✓, 9✓, 3, 8✓, 1');
    expect(diceList(rollFormula('3d6cf<=2', showing(6, 1, 5, 2)).rolls)).toBe('1✗, 5, 2✗');
    expect(diceList([dF(1), dF(-1), dF(0)])).toBe('+, −, 0');
    expect(diceList(rollFormula('2d6r1kh1*2', showing(6, 1, 3, 5)).rolls)).toBe('1→(3), 5');
  });
});

describe('dieLabel', () => {
  it('shows each die with its term, its label and its marks', () => {
    const rolls = rollFormula('4d6r1kh3[fire]', showing(6, 1, 2, 3, 4, 5)).rolls;
    expect(rolls.map((_, i) => dieLabel(rolls, i))).toEqual(['d6[fire]: 1→', 'd6[fire]: (2)', 'd6[fire]: 3', 'd6[fire]: 4', 'd6[fire]: 5']);
    expect(dieLabel([dF(1), dF(-1), dF(0)], 1)).toBe('dF: −');
    expect(dieLabel([d(10, 1), d(10, 7, { exploded: true, negative: true })], 1)).toBe('−d10: 7');
  });
});

describe('dieStates', () => {
  it('highlights highest and lowest faces only on dice that count', () => {
    expect(dieStates(d(20, 20))).toEqual(['max']);
    expect(dieStates(d(20, 1))).toEqual(['min']);
    expect(dieStates(d(20, 20, { dropped: true }))).toEqual(['dropped']);
    expect(dieStates(d(6, 1, { rerolled: true }))).toEqual(['rerolled']);
    expect(dieStates(d(10, 10, { success: true }))).toEqual(['max', 'success']);
    expect(dieStates(d(10, 1, { failure: true }))).toEqual(['min', 'failure']);
    expect(dieStates(dF(-1))).toEqual(['min']);
    expect(dieStates(dF(0))).toEqual([]);
  });
});

it('DiceTool with the full notation', () => {
  const inputs = (random: () => number) => ({ random, rollId: (): string => 'roll', roller: (): string => 'Mira', onFormulaError: (): void => {} });

  // rolls formulas that are no plain sum and says so
  {
    const tool = new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, inputs(showing(6, 4)));
    expect(tool.rollDice('1d6*2+1')).toMatchObject({ total: 9, modifiers: 0, linear: false });
    expect(tool.rollDice('1d6+1')).not.toHaveProperty('linear');
  }

  // completes a bonus without dice, labels kept whole, and never a formula with dice
  {
    const tool = new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, inputs(showing(20, 10)));
    expect(tool.rollDice('+ 3[magic bonus]')?.formula).toBe('1d20+3[magic bonus]');
    expect(tool.rollDice('2*3')).toMatchObject({ formula: '1d20+2*3', total: 16 });
    expect(tool.rollDice('2d20kh1')?.formula).toBe('2d20kh1');
  }
});
