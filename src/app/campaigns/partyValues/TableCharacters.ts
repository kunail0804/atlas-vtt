import type { App } from 'obsidian';
import { TableFile } from '../TableFile';
import { emptyTableCharacters, TABLE_CHARACTERS_LAYOUT, TABLE_CHARACTERS_PATH } from './tableCharactersFile';
import { isWritable, withPartyChanges, type PartyChanges, type StoredCharacters } from './charactersFile';

/**
 * The values the GM's table keeps of its player characters (`tableCharactersFile.ts`): one file for
 * the vault, whatever world is played; read with `load`.
 */
export class TableCharacters extends TableFile<StoredCharacters> {
  constructor(app: App) {
    super(app, { path: TABLE_CHARACTERS_PATH, layout: TABLE_CHARACTERS_LAYOUT, isWritable, empty: emptyTableCharacters });
  }

  /** Writes `changes` into the file, value by value, creating it when the vault has none; false where it cannot be changed (`blocked`). */
  write(changes: PartyChanges): boolean {
    return this.change((stored) => withPartyChanges(stored, changes));
  }
}
