/**
 * Evaluates a parsed formula against a statblock's values. Text that is a
 * number ("14", "+3") counts as one; anything else is an error in plain words.
 */

import type { FieldValue } from '../model/templateTypes';
import { isEmptyValue } from '../values/emptyValue';
import { isPlainRecord } from '../values/fieldValueOf';
import { indexInto, splitRef, type ValueReader } from '../values/fieldValues';
import { listItems } from '../values/listText';
import { numericValue } from '../values/numberText';
import { quoted } from '../values/valueText';
import { nameOf, refError, type ExpressionError, type LabelResolver } from './errors';
import { SLOT_WORD, type EachMode, type FormulaFunction, type FormulaNode } from './formulaTypes';
import { t } from '../../i18n';

export interface FormulaContext {
  /** The score of the current Scores slot, which the word `value` reads. */
  value?: FieldValue | undefined;
  /** The slot's label ("Str") for messages about `value`. */
  slotLabel?: string | undefined;
  labelOf?: LabelResolver | undefined;
}

export type FormulaResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

type Step = number | ExpressionError;

const ONE_ARGUMENT: Readonly<Record<'floor' | 'ceil' | 'round' | 'abs', (value: number) => number>> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
};

function failed(step: Step): step is ExpressionError {
  return typeof step !== 'number';
}

function notANumber(message: string): ExpressionError {
  return { kind: 'not-a-number', message };
}

function asNumber(raw: FieldValue | undefined, ref: string, name: string): Step {
  if (isEmptyValue(raw)) return refError('unbound', ref, `${name} is empty.`);
  const number = numericValue(raw);
  return number === null ? refError('not-a-number', ref, `${name} isn't a number.`) : number;
}

function slotValue(context: FormulaContext): Step {
  if (context.slotLabel === undefined && isEmptyValue(context.value)) {
    return refError('unbound', SLOT_WORD, `${quoted(SLOT_WORD)} is the score of a Scores column, and there is none here.`);
  }
  return asNumber(context.value, SLOT_WORD, context.slotLabel ?? quoted(SLOT_WORD));
}

function arithmetic(op: '+' | '-' | '*' | '/', left: number, right: number): Step {
  switch (op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return right === 0 ? notANumber("Can't divide by zero.") : left / right;
  }
}

function call(fn: FormulaFunction, values: number[]): number {
  if (fn === 'min') return Math.min(...values);
  if (fn === 'max') return Math.max(...values);
  return ONE_ARGUMENT[fn](values[0] ?? Number.NaN);
}

function evaluateNode(node: FormulaNode, reader: ValueReader, context: FormulaContext): Step {
  switch (node.kind) {
    case 'number': return node.value;
    case 'ref': return asNumber(reader(node.ref), node.ref, nameOf(node.ref, context.labelOf));
    case 'slot': return slotValue(context);
    case 'negate': {
      const operand = evaluateNode(node.operand, reader, context);
      return failed(operand) ? operand : -operand;
    }
    case 'binary': {
      const left = evaluateNode(node.left, reader, context);
      if (failed(left)) return left;
      const right = evaluateNode(node.right, reader, context);
      return failed(right) ? right : arithmetic(node.op, left, right);
    }
    case 'call': {
      const values: number[] = [];
      for (const arg of node.args) {
        const value = evaluateNode(arg, reader, context);
        if (failed(value)) return value;
        values.push(value);
      }
      return call(node.fn, values);
    }
    case 'has': return holds(reader(node.ref), node.text) ? 1 : 0;
    case 'sides': return sidesOf(reader(node.ref), node.ref, nameOf(node.ref, context.labelOf));
    case 'each': return each(node.mode, node.ref, node.body, reader, context);
  }
}

const DIE = /^\s*1?\s*d(\d+)\s*$/i;

/** The sides of a die written `d10` (or `1d10`). */
function sidesOf(raw: FieldValue | undefined, ref: string, name: string): Step {
  if (isEmptyValue(raw)) return refError('unbound', ref, t('statblockEditor.expr.emptyDie', { name }));
  const sides = typeof raw === 'string' ? DIE.exec(raw)?.[1] : undefined;
  return sides === undefined ? refError('not-a-number', ref, t('statblockEditor.expr.notADie', { name })) : Number(sides);
}

/** A reader of one entry's parts: `level`, `stats.1` inside a part that is a list. */
function entryReader(entry: Record<string, FieldValue>): ValueReader {
  return (ref) => {
    const { key, index } = splitRef(ref);
    const part = indexInto(entry, key);
    return index === null ? part : indexInto(part, index);
  };
}

/** `body` worked out for every entry of the list and added up, or for its first entry. */
function each(mode: EachMode, ref: string, body: FormulaNode, reader: ValueReader, context: FormulaContext): Step {
  const name = nameOf(ref, context.labelOf);
  const raw = reader(ref);
  const list = isEmptyValue(raw) ? [] : raw;
  if (!Array.isArray(list)) return refError('not-a-number', ref, t('statblockEditor.expr.notAList', { name }));
  const entries = list.filter((item): item is Record<string, FieldValue> => isPlainRecord(item));
  if (entries.length < list.length) return refError('not-a-number', ref, t('statblockEditor.expr.notAList', { name }));
  // The entry's parts are named by their own keys, never by the statblock's labels.
  const inner: FormulaContext = {};
  if (mode === 'first') {
    const [first] = entries;
    return first === undefined ? refError('unbound', ref, t('statblockEditor.expr.emptyList', { name })) : evaluateNode(body, entryReader(first), inner);
  }
  let total = 0;
  for (const entry of entries) {
    const value = evaluateNode(body, entryReader(entry), inner);
    if (failed(value)) return value;
    total += value;
  }
  return total;
}

/** Whether a list, or a line of picks ("Stealth, Arcana"), holds the text, in any case; an empty field holds nothing. */
function holds(value: FieldValue | undefined, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return listItems(value).some((item) => item.trim().toLowerCase() === wanted);
}

/** The formula's value, or why it has none. Never throws. */
export function evaluateFormula(node: FormulaNode, reader: ValueReader, context: FormulaContext = {}): FormulaResult {
  const result = evaluateNode(node, reader, context);
  if (failed(result)) return { ok: false, error: result };
  if (!Number.isFinite(result)) return { ok: false, error: notANumber(t('statblockEditor.expr.tooLarge')) };
  return { ok: true, value: result === 0 ? 0 : result };
}
