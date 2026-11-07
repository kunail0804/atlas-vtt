/**
 * The formula language (§5.6): numbers, field references, `value` (the score
 * of the current Scores slot), + - * /, brackets, unary minus, the functions
 * floor, ceil, round, abs, min and max, and `has(ref, "text")`, 1 where a list
 * or a choice of several holds the text and 0 where it does not.
 */

export type FormulaFunction = 'floor' | 'ceil' | 'round' | 'abs' | 'min' | 'max';
export type BinaryOperator = '+' | '-' | '*' | '/';

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; ref: string }
  /** The word `value`: the current Scores slot's score. */
  | { kind: 'slot' }
  | { kind: 'negate'; operand: FormulaNode }
  | { kind: 'binary'; op: BinaryOperator; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; fn: FormulaFunction; args: FormulaNode[] }
  /** `has(ref, "text")`: whether the field (a list, or a line of picks) holds the text. */
  | { kind: 'has'; ref: string; text: string };

/** The function that tests a list for a text; its text is the only quoted text a formula holds. */
export const HAS_FUNCTION = 'has';

/** How many arguments each function takes. */
export const FORMULA_FUNCTIONS: Readonly<Record<FormulaFunction, { min: number; max: number }>> = {
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 1, max: Infinity },
  max: { min: 1, max: Infinity },
};

export function isFormulaFunction(name: string): name is FormulaFunction {
  return Object.hasOwn(FORMULA_FUNCTIONS, name);
}

/** The word a formula reads the current Scores slot with. */
export const SLOT_WORD = 'value';

export type FormulaToken =
  | { type: 'number'; value: number; at: number; text: string }
  | { type: 'name'; name: string; at: number }
  /** A quoted text, `"Stealth"`, which only `has` takes. */
  | { type: 'text'; text: string; at: number }
  | { type: 'op'; op: BinaryOperator; at: number }
  | { type: 'open' | 'close' | 'comma' | 'end'; at: number };
