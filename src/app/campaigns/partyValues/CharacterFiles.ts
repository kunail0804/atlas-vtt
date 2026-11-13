import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { CHARACTERS_LAYOUT, type StoredCharacters } from './charactersFile';

/**
 * The worlds' own characters files (`charactersFile.ts`), one per world folder that kept values before
 * they moved into one file for the vault (`TableCharacters`). Atlas only reads them, once, to carry
 * them over; they stay on disk for older versions.
 */
export class CharacterFiles extends RecordFiles<StoredCharacters> {
  constructor(app: App) {
    super(app, CHARACTERS_LAYOUT);
  }
}
