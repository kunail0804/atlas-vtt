/**
 * Readers for the SRD JSON of 5e-bits/5e-database. The data comes from outside the project, so
 * every value is `unknown` until one of these reads it; a value of the wrong shape reads as empty
 * rather than throwing, and the note simply leaves that line out.
 */

export type Json = Record<string, unknown>;

export function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function records(value: unknown): Json[] {
  return list(value).filter(isJson);
}

export function field(value: unknown, key: string): unknown {
  return isJson(value) ? value[key] : undefined;
}

/** The `name` of a reference such as `{ index, name, url }`. */
export function nameOf(value: unknown): string {
  return text(field(value, 'name'));
}

export function indexOf(value: unknown): string {
  return text(field(value, 'index'));
}

/** The names of a list of references, in order, without empty ones. */
export function names(value: unknown): string[] {
  return list(value).map(nameOf).filter((name) => name !== '');
}

/**
 * Prose as the two editions write it: 2014 as a list of paragraphs (`desc`), 2024 as one string
 * (`description`, sometimes `desc`). Paragraphs are joined by a blank line.
 */
export function prose(record: Json): string {
  const value = record.description ?? record.desc;
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join('\n\n').trim();
  return text(value).trim();
}

/** "15 gp" from `{ quantity: 15, unit: 'gp' }`. */
export function cost(value: unknown): string {
  const quantity = num(field(value, 'quantity'));
  const unit = text(field(value, 'unit'));
  return quantity === undefined ? '' : `${quantity} ${unit}`.trim();
}

export function capitalize(value: string): string {
  return value === '' ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}
