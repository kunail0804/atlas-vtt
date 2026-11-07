/**
 * Pattern filters. A value runs through its filters as a list of items (a
 * list field's entries, or one item per ref), and an item a filter empties is
 * dropped. Filters:
 * - `signed`: numbers with their sign, "+3", "+0", "-1" (ASCII minus);
 * - `upper`, `lower`: letter case;
 * - `count`: how many items there are;
 * - `avg`: the average of dice notation, rounded down ("7d10 + 14" is 52);
 * - `lookup:<table>`: the row of one of the template's lookup tables; no row, no value;
 * - `join:<text>`: the items joined by the text, as written ("join:; ");
 * - `sum`: the total of the items that are numbers;
 * - `pluck:<key>`: each item's part of that name (a list's entries' `level`);
 * - `pool:<count>,<die>`: the dice the items make, each `count` of its `die`, the same dice added up
 *   ("3d10 + 2d6" for a fighter 3 and a wizard 2 of a list of classes).
 */

import type { FieldValue } from '../model/templateTypes';
import { diceAverage } from '../values/diceNotation';
import { isEmptyValue } from '../values/emptyValue';
import { indexInto } from '../values/fieldValues';
import { formatSigned, numericValue, parseRatingText } from '../values/numberText';
import { quoted, valueText } from '../values/valueText';
import { refError, syntaxError, type ExpressionError } from './errors';
import type { PatternFilter, PatternFilterName } from './patternTypes';
import { t } from '../../i18n';

/** The template's lookup tables: name, then row, then the row's text. */
export type Lookups = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface FilterStep {
  items: FieldValue[];
  problem?: ExpressionError;
}

const PLAIN_FILTERS: ReadonlySet<string> = new Set<PatternFilterName>(['signed', 'upper', 'lower', 'count', 'avg', 'sum']);
const ALL_FILTERS = 'signed, upper, lower, count, avg, sum, lookup, join, pluck and pool';

function isPlainFilter(name: string): name is 'signed' | 'upper' | 'lower' | 'count' | 'avg' | 'sum' {
  return PLAIN_FILTERS.has(name);
}

/** A filter as written between `|` and the next `|` or `}`; `at` is its offset in the pattern. */
export function parseFilter(source: string, at: number): PatternFilter | ExpressionError {
  const colon = source.indexOf(':');
  const name = (colon < 0 ? source : source.slice(0, colon)).trim().toLowerCase();
  const argument = colon < 0 ? null : source.slice(colon + 1);
  if (name === 'lookup') {
    const table = argument?.trim();
    return table ? { name, table } : syntaxError('lookup needs the name of a table, like {cr|lookup:xp}.', at);
  }
  if (name === 'join') {
    return argument === null ? syntaxError('join needs the text to join with, like {a, b|join:; }.', at) : { name, text: argument };
  }
  if (name === 'pluck') {
    const key = argument?.trim();
    return key ? { name, key } : syntaxError('pluck needs the name of a part, like {classes|pluck:level}.', at);
  }
  if (name === 'pool') {
    const [count, die, ...rest] = (argument ?? '').split(',').map((part) => part.trim());
    return count && die && rest.length === 0 ? { name, count, die } : syntaxError('pool needs the parts of the count and of the die, like {classes|pool:level,die}.', at);
  }
  if (isPlainFilter(name)) {
    return argument === null ? { name } : syntaxError(`${name} takes nothing after ${quoted(':')}.`, at);
  }
  if (name === '') return syntaxError(`A filter is missing after ${quoted('|')}.`, at);
  return syntaxError(t('statblockEditor.expr.noFilter', { name: quoted(name), filters: ALL_FILTERS }), at);
}

/** A table's row for a value: as written, then in any case, then as the same rating ("½" finds "1/2"). */
export function lookupRow(table: Readonly<Record<string, string>>, key: string): string | undefined {
  const wanted = key.trim();
  if (Object.hasOwn(table, wanted)) return table[wanted];
  const rows = Object.entries(table);
  const lower = wanted.toLowerCase();
  const byCase = rows.find(([row]) => row.trim().toLowerCase() === lower);
  if (byCase) return byCase[1];
  const rating = parseRatingText(wanted);
  if (rating === null) return undefined;
  return rows.find(([row]) => parseRatingText(row) === rating)?.[1];
}

function signed(item: FieldValue): FieldValue {
  const number = numericValue(item);
  return number === null ? item : formatSigned(number);
}

function present(items: FieldValue[]): FilterStep {
  return { items: items.filter((item) => !isEmptyValue(item)) };
}

function lookUp(items: readonly FieldValue[], tableName: string, lookups: Lookups | undefined): FilterStep {
  const table = lookups && Object.hasOwn(lookups, tableName) ? lookups[tableName] : undefined;
  if (!table) return { items: [], problem: refError('unbound', tableName, t('statblockEditor.expr.noTable', { name: quoted(tableName) })) };
  return present(items.map((item) => lookupRow(table, valueText(item)) ?? null));
}

/** Runs one filter over a value's items; items it empties are dropped. */
export function applyFilter(items: readonly FieldValue[], filter: PatternFilter, lookups?: Lookups): FilterStep {
  switch (filter.name) {
    case 'signed': return present(items.map(signed));
    case 'upper': return present(items.map((item) => valueText(item).toUpperCase()));
    case 'lower': return present(items.map((item) => valueText(item).toLowerCase()));
    case 'count': return { items: [items.length] };
    case 'avg': return present(items.map((item) => diceAverage(valueText(item))));
    case 'lookup': return lookUp(items, filter.table, lookups);
    case 'join': return present([items.map(valueText).filter((text) => text.trim() !== '').join(filter.text)]);
    case 'sum': return sum(items);
    case 'pluck': return present(items.map((item) => indexInto(item, filter.key) ?? null));
    case 'pool': return pool(items, filter.count, filter.die);
  }
}

function sum(items: readonly FieldValue[]): FilterStep {
  const numbers = items.map(numericValue).filter((number): number is number => number !== null);
  return { items: numbers.length === 0 ? [] : [numbers.reduce((total, number) => total + number, 0)] };
}

const DIE = /^d(\d+)$/i;

function pool(items: readonly FieldValue[], countKey: string, dieKey: string): FilterStep {
  const counts = new Map<string, number>();
  for (const item of items) {
    const die = DIE.exec(valueText(indexInto(item, dieKey) ?? null).trim())?.[1];
    const count = numericValue(indexInto(item, countKey) ?? null);
    if (die !== undefined && count !== null && count > 0) counts.set(`d${die}`, (counts.get(`d${die}`) ?? 0) + count);
  }
  return present([[...counts].map(([die, count]) => `${count}${die}`).join(' + ')]);
}
