import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { TABLE_FILE_ID } from '../tableFileLayout';
import { emptyTableCharacters, TABLE_CHARACTERS_LAYOUT, TABLE_CHARACTERS_PATH } from './tableCharactersFile';
import { isWritable, withPartyChanges, type PartyChanges, type StoredCharacters } from './charactersFile';

/**
 * The values the GM's table keeps of its player characters (`tableCharactersFile.ts`): one file for
 * the vault, whatever world is played; read with `load`.
 */
export class TableCharacters extends RecordFiles<StoredCharacters> {
  constructor(app: App) {
    super(app, TABLE_CHARACTERS_LAYOUT);
  }

  /** The file, once read; undefined while the vault has none. */
  stored(): StoredCharacters | undefined {
    return this.entries().find((entry) => entry.id === TABLE_FILE_ID);
  }

  /** Whether the file can be changed: it does not exist yet, or is of a format this Atlas writes. */
  isWritable(): boolean {
    const stored = this.stored();
    return stored === undefined || isWritable(stored);
  }

  /** Writes `changes` into the file, value by value, creating it when the vault has none. */
  write(changes: PartyChanges): void {
    const change = (stored: StoredCharacters): StoredCharacters => withPartyChanges(stored, changes);
    if (this.stored() !== undefined) this.update(TABLE_FILE_ID, change);
    else this.createAt(TABLE_CHARACTERS_PATH, change(emptyTableCharacters()), change);
  }
}
