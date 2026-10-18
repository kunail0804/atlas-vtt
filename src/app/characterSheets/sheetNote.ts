import { readField, readFields, readRow, type SheetRow, type SheetValue, type SheetValues } from './sheetFields.ts';
import { MAX_PLAYER_NOTES, PLAYER_NOTES_KEY, SHEET_KEY, type NoteValue, type SheetSystem } from './sheetSystem.ts';
import { sheetSystem } from './sheetSystems.ts';

/** A character sheet as its note holds it: its system, its values, and the notes linked for its player. */
export interface NoteSheet {
  readonly system: SheetSystem;
  readonly values: SheetValues;
  /** As written: `[[Note]]`, `[[Folder/Note|alias]]` or a plain path. */
  readonly playerNotes: readonly string[];
}

/** The sheet a note's frontmatter holds, or null for a note that is no character sheet (or of a system this Atlas does not know). */
export function readNoteSheet(frontmatter: Readonly<Record<string, unknown>> | null | undefined): NoteSheet | null {
  const system = sheetSystem(frontmatter?.[SHEET_KEY]);
  if (frontmatter == null || system === null) return null;
  const links = frontmatter[PLAYER_NOTES_KEY];
  const playerNotes = Array.isArray(links) ? links.filter((link): link is string => typeof link === 'string' && link.trim() !== '').slice(0, MAX_PLAYER_NOTES) : [];
  return { system, values: readFields(system.fields, frontmatter), playerNotes };
}

/** Everything a sheet writes into its note's frontmatter: its marker, its values and what Fantasy Statblocks reads beside them. */
export function sheetFrontmatter(system: SheetSystem, values: SheetValues): Readonly<Record<string, NoteValue>> {
  return { ...(values as Record<string, NoteValue>), ...system.statblockKeys(values), [SHEET_KEY]: system.id };
}

/** A change to a sheet: a field set whole, or one row of a table set, added (`index` the row count) or taken out (`row` null). */
export type SheetEdit =
  | { readonly op: 'set'; readonly key: string; readonly value: unknown }
  | { readonly op: 'row'; readonly key: string; readonly index: number; readonly row: unknown };

/** The values after `edit`, by the system's own rules; null where the edit is none it allows. */
export function applySheetEdit(system: SheetSystem, values: SheetValues, edit: SheetEdit): SheetValues | null {
  const spec = Object.hasOwn(system.fields, edit.key) ? system.fields[edit.key] : undefined;
  if (spec === undefined) return null;
  if (edit.op === 'set') {
    if (spec.kind === 'rows') return null;
    const value: SheetValue | undefined = readField(spec, edit.value);
    return value === undefined ? null : { ...values, [edit.key]: value };
  }
  if (spec.kind !== 'rows' || !Number.isInteger(edit.index) || edit.index < 0) return null;
  const rows = Array.isArray(values[edit.key]) ? [...(values[edit.key] as readonly SheetRow[])] : [];
  if (edit.row === null) {
    if (edit.index >= rows.length) return null;
    rows.splice(edit.index, 1);
    return { ...values, [edit.key]: rows };
  }
  const row = readRow(spec.cells, edit.row);
  if (row === undefined || edit.index > rows.length || (edit.index === rows.length && rows.length >= spec.max)) return null;
  rows[edit.index] = row;
  return { ...values, [edit.key]: rows };
}

/** A new sheet of `system`: every field empty, with the name and level a character starts with. */
export function newSheet(system: SheetSystem, name: string): SheetValues {
  return { ...readFields(system.fields, {}), name, ...(Object.hasOwn(system.fields, 'level') && { level: 1 }) };
}
