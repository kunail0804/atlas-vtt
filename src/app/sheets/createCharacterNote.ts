import type { App, TFile } from 'obsidian';
import { createStatblockNote } from '../statblocks/notes/createStatblockNote';
import { FIVE_E_2024_CHARACTER_ID } from '../statblocks/presets/fiveECharacter';
import type { CharacterTemplateId } from './characterTemplates';

/** Where new character sheets go. */
export const SHEET_FOLDER = 'Personnages';

/** What a new character starts with: level 1, every ability at 10, no initiative bonus. */
const NEW_CHARACTER = { level: 1, stats: [10, 10, 10, 10, 10, 10], initiative_bonus: 0 };

export interface NewCharacterNote {
  readonly name: string;
  /** The library token it is for: linked to the note, its art the note's `image`. */
  readonly tokenImagePath?: string | undefined;
  readonly templateId?: CharacterTemplateId;
}

/** Creates a character sheet (a native statblock of the 5E character template) in `SHEET_FOLDER` and links the token to it. */
export async function createCharacterNote(app: App, note: NewCharacterNote): Promise<TFile> {
  const created = await createStatblockNote(app, {
    name: note.name.trim() || 'Personnage',
    templateId: note.templateId ?? FIVE_E_2024_CHARACTER_ID,
    folder: SHEET_FOLDER,
    tokenImagePath: note.tokenImagePath,
    values: NEW_CHARACTER,
  });
  return created.file;
}
