import type { FieldSpec, SheetValues } from './sheetFields.ts';

/** A frontmatter value as a note keeps it. */
export type NoteValue = string | number | boolean | null | NoteValue[] | { [key: string]: NoteValue };

/**
 * A game system's character sheet: what it holds (`fields`, each a frontmatter key of the sheet's
 * note), what follows from it, and what it writes beside its own keys so that Fantasy Statblocks and
 * Atlas read the note as the statblock it is (`statblockKeys`).
 */
export interface SheetSystem<Derived = unknown> {
  readonly id: string;
  /** Shown where a GM picks a system. */
  readonly name: string;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  derive(values: SheetValues): Derived;
  statblockKeys(values: SheetValues): Readonly<Record<string, NoteValue>>;
  /** The values with what follows from others written in (a 5e sheet's class and level from its classes); after every edit. */
  settle?(values: SheetValues): SheetValues;
}

/** The frontmatter key that names a note's sheet system; a note with it is a character sheet. */
export const SHEET_KEY = 'atlas-sheet';
/** The frontmatter key of the notes the GM links to the character for its player, as `[[links]]`. */
export const PLAYER_NOTES_KEY = 'atlas-player-notes';
/** The most notes a character's player is given. */
export const MAX_PLAYER_NOTES = 30;
