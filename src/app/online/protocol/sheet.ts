import { MAX_PLAYER_NOTES } from '../../characterSheets/sheetSystem.ts';
import { sheetSystem } from '../../characterSheets/sheetSystems.ts';
import { readFields, type SheetValues } from '../../characterSheets/sheetFields.ts';
import { parseFoundNote, type FoundNote } from './logShown.ts';
import { isRecord } from './shape.ts';

/**
 * The character sheet of a player's own character, and the notes the GM linked to it for them. Sent
 * to that player alone, whole, whenever either changes (`sheet` null: their character has none).
 * What the player changes goes back field by field (`sheet-edit`); the GM writes it into the sheet's
 * note at once and sends the sheet again.
 */
export interface SharedSheet {
  readonly system: string;
  readonly values: SheetValues;
}

export type SheetMessage = { readonly t: 'sheet'; readonly sheet: SharedSheet | null; readonly notes: readonly FoundNote[] };

export type PlayerSheetEdit =
  | { readonly t: 'sheet-edit'; readonly key: string; readonly value: SheetEditValue }
  | { readonly t: 'sheet-row'; readonly key: string; readonly index: number; readonly row: Readonly<Record<string, string | number | boolean>> | null };

export type SheetEditValue = string | number | boolean | readonly (string | number)[];

const KEY = /^[a-z][a-z0-9-]{0,39}$/;
/** The most rows a sheet's table holds, and the most cells a row or entries a list. */
const MAX_INDEX = 1_000;
const MAX_ITEMS = 100;
const isPrimitive = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/** A sheet as the player's page reads it: a system it knows, every field read by that system's rules; null for none. */
export function parseSheetMessage(value: Record<string, unknown>): SheetMessage | null {
  if (!Array.isArray(value.notes) || value.notes.length > MAX_PLAYER_NOTES) return null;
  const notes = value.notes.map((note: unknown) => (isRecord(note) ? parseFoundNote(note) : null));
  if (!notes.every((note): note is FoundNote => note !== null)) return null;
  if (value.sheet === null) return { t: 'sheet', sheet: null, notes };
  if (!isRecord(value.sheet) || !isRecord(value.sheet.values)) return null;
  const system = sheetSystem(value.sheet.system);
  return { t: 'sheet', sheet: system === null ? null : { system: system.id, values: readFields(system.fields, value.sheet.values) }, notes };
}

/** A player's change to their sheet, by shape only: the GM checks it against the sheet's system. */
export function parsePlayerSheetEdit(value: Record<string, unknown>): PlayerSheetEdit | null {
  const { key } = value;
  if (typeof key !== 'string' || !KEY.test(key)) return null;
  if (value.t === 'sheet-edit') {
    const edit = value.value;
    if (isPrimitive(edit)) return { t: 'sheet-edit', key, value: edit };
    if (Array.isArray(edit) && edit.length <= MAX_ITEMS && edit.every((entry) => typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)))) return { t: 'sheet-edit', key, value: edit as (string | number)[] };
    return null;
  }
  if (value.t !== 'sheet-row' || !Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > MAX_INDEX) return null;
  if (value.row === null) return { t: 'sheet-row', key, index: value.index as number, row: null };
  if (!isRecord(value.row) || Object.keys(value.row).length > MAX_ITEMS || !Object.values(value.row).every(isPrimitive)) return null;
  return { t: 'sheet-row', key, index: value.index as number, row: value.row as Record<string, string | number | boolean> };
}

export const isPlayerSheetType = (value: unknown): boolean => value === 'sheet-edit' || value === 'sheet-row';
