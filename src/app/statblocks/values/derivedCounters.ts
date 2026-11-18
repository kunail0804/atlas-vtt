/**
 * What a worked-out Counters field holds (`TemplateField.derive` on a `counters` field, a character's
 * spell slots): the pattern's text names rows and their maxima, `Niveau 1: 4, Niveau 2: 3, Niveau 3: 0`,
 * and only the maxima follow it. Pure.
 */

import type { FieldValue } from '../model/templateTypes';
import { isPlainRecord } from './fieldValueOf';

/** One row the pattern names: its name and maximum. */
export interface DerivedCounter {
  readonly name: string;
  readonly max: number;
}

const ROW = /^(.*\S)\s*:\s*(\d+)$/;

/** The rows a pattern's text names, or null where some part of it is no `name: maximum`. */
export function parseDerivedCounters(text: string): DerivedCounter[] | null {
  const rows: DerivedCounter[] = [];
  for (const part of text.split(',')) {
    const match = ROW.exec(part.trim());
    if (match?.[1] === undefined || match[2] === undefined) return null;
    rows.push({ name: match[1], max: Number(match[2]) });
  }
  return rows;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The note's rows once the pattern's maxima apply: a row it names takes that maximum and keeps its
 * other keys, what was spent of it brought down to the new maximum; a row it names at 0 goes; a row it
 * names that the note lacks comes in, nothing spent. Named rows come first, in the pattern's order,
 * then the note's other rows (a row of the character's own), as they were.
 */
export function withDerivedCounters(current: FieldValue | undefined, derived: readonly DerivedCounter[]): FieldValue[] {
  const rows = Array.isArray(current) ? current : [];
  const nameOf = (row: FieldValue): string | null => (isPlainRecord(row) && typeof row.name === 'string' ? row.name : null);
  const named: FieldValue[] = [];
  for (const { name, max } of derived) {
    if (max === 0) continue;
    const held = rows.find((row) => {
      const own = nameOf(row);
      return own !== null && sameName(own, name);
    });
    if (!isPlainRecord(held)) {
      named.push({ name, max });
      continue;
    }
    const used = typeof held.used === 'number' && Number.isFinite(held.used) ? Math.max(0, Math.min(max, held.used)) : undefined;
    named.push({ ...held, max, ...(used !== undefined && { used }) });
  }
  const others = rows.filter((row) => {
    const own = nameOf(row);
    return own === null || !derived.some((counter) => sameName(counter.name, own));
  });
  return [...named, ...others];
}
