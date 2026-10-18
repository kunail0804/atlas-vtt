import { bookLine, bookText } from '../online/protocol/bookText.ts';

/**
 * What a character sheet holds, field by field, and the one reading of a value: from a note's
 * frontmatter, and from what a player sends. Pure data, no Obsidian and no React.
 */

export type SheetValue = string | number | boolean | readonly string[] | readonly number[] | readonly SheetRow[];
export type SheetRow = Readonly<Record<string, string | number | boolean>>;
export type SheetValues = Readonly<Record<string, SheetValue>>;

/** A cell of a row: one line, several lines, a whole number, or a box. */
export type CellSpec =
  | { readonly kind: 'text'; readonly max: number }
  | { readonly kind: 'longtext'; readonly max: number }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'bool' };

export type FieldSpec =
  | CellSpec
  | { readonly kind: 'choice'; readonly options: readonly string[] }
  /** Any of `options`, each once, in the order of `options`. */
  | { readonly kind: 'set'; readonly options: readonly string[] }
  /** Exactly `length` whole numbers. */
  | { readonly kind: 'ints'; readonly length: number; readonly min: number; readonly max: number }
  /** Up to `max` rows of the named cells. */
  | { readonly kind: 'rows'; readonly max: number; readonly cells: Readonly<Record<string, CellSpec>> };

/** A line of text as a sheet keeps it: cleaned as a book's text is, within `max` characters (empty allowed). */
function line(value: unknown, max: number): string | undefined {
  return bookLine(typeof value === 'number' && Number.isFinite(value) ? String(value) : value, max, true) ?? undefined;
}

function text(value: unknown, max: number): string | undefined {
  return bookText(typeof value === 'number' && Number.isFinite(value) ? String(value) : value, max) ?? undefined;
}

function int(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

function cell(spec: CellSpec, value: unknown): string | number | boolean | undefined {
  switch (spec.kind) {
    case 'text': return line(value, spec.max);
    case 'longtext': return text(value, spec.max);
    case 'int': return int(value, spec.min, spec.max);
    case 'bool': return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
  }
}

/** A row with every cell of `cells` read (a cell that cannot be read takes its empty value); undefined for no record. */
export function readRow(cells: Readonly<Record<string, CellSpec>>, value: unknown): SheetRow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const row: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(cells)) row[key] = (Object.hasOwn(record, key) ? cell(spec, record[key]) : undefined) ?? emptyCell(spec);
  return row;
}

const emptyCell = (spec: CellSpec): string | number | boolean => (spec.kind === 'int' ? Math.max(0, spec.min) : spec.kind === 'bool' ? false : '');

/** A field's value as the sheet holds it, or undefined where `value` is none of it. */
export function readField(spec: FieldSpec, value: unknown): SheetValue | undefined {
  switch (spec.kind) {
    case 'text': case 'longtext': case 'int': case 'bool':
      return cell(spec, value);
    case 'choice':
      return typeof value === 'string' && (value === '' || spec.options.includes(value)) ? value : undefined;
    case 'set': {
      if (!Array.isArray(value)) return undefined;
      const picked = new Set(value.filter((entry): entry is string => typeof entry === 'string'));
      return spec.options.filter((option) => picked.has(option));
    }
    case 'ints': {
      if (!Array.isArray(value) || value.length !== spec.length) return undefined;
      const numbers = value.map((entry) => int(entry, spec.min, spec.max));
      return numbers.every((entry): entry is number => entry !== undefined) ? numbers : undefined;
    }
    case 'rows': {
      if (!Array.isArray(value) || value.length > spec.max) return undefined;
      const rows = value.map((entry) => readRow(spec.cells, entry));
      return rows.every((row): row is SheetRow => row !== undefined) ? rows : undefined;
    }
  }
}

/** The value a field starts with. */
export function emptyField(spec: FieldSpec): SheetValue {
  switch (spec.kind) {
    case 'text': case 'longtext': return '';
    case 'int': return Math.max(0, spec.min);
    case 'bool': return false;
    case 'choice': return '';
    case 'set': return [];
    case 'ints': return Array.from({ length: spec.length }, () => Math.max(spec.min, Math.min(spec.max, 10)));
    case 'rows': return [];
  }
}

/** Every field of `fields` read from `source`, each that cannot be read at its empty value. */
export function readFields(fields: Readonly<Record<string, FieldSpec>>, source: Readonly<Record<string, unknown>>): SheetValues {
  const values: Record<string, SheetValue> = {};
  for (const [key, spec] of Object.entries(fields)) values[key] = (Object.hasOwn(source, key) ? readField(spec, source[key]) : undefined) ?? emptyField(spec);
  return values;
}
