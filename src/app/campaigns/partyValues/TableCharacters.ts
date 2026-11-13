import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import type { CampaignStorage } from '../CampaignFiles';
import { carryWorldsInto, lastPlayedOf, TABLE_FILE_ID } from '../tableFileLayout';
import { CharacterFiles } from './CharacterFiles';
import { emptyTableCharacters, TABLE_CHARACTERS_LAYOUT, TABLE_CHARACTERS_PATH } from './tableCharactersFile';
import { isWritable, withPartyChanges, type PartyChanges, type StoredCharacters } from './charactersFile';
import { mergeWorldCharacters } from './charactersMigration';

/**
 * The values the GM's table keeps of its player characters (`tableCharactersFile.ts`): one file for
 * the vault, whatever world is played. Before it is ready the worlds' own characters files are
 * carried into it where the vault has none yet (`whenReady`).
 */
export class TableCharacters extends RecordFiles<StoredCharacters> {
  private readying: Promise<void> | null = null;

  constructor(app: App, private readonly campaigns: CampaignStorage) {
    super(app, TABLE_CHARACTERS_LAYOUT);
  }

  /**
   * Settles once the file was read and, where the vault had none, the worlds' characters files were
   * carried into it (`mergeWorldCharacters`). A failed migration is logged and leaves the file as it is.
   */
  whenReady(): Promise<void> {
    return (this.readying ??= this.load()
      .then(() => this.carryWorldsIn())
      .catch((error: unknown) => console.error('[Atlas] Carrying the worlds\' characters into the table\'s characters file failed:', error)));
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

  /** Writes the worlds' values merged into this file, where the vault has none (`carryWorldsInto`). */
  private async carryWorldsIn(): Promise<void> {
    await carryWorldsInto(this.app, this, TABLE_CHARACTERS_PATH, async () => {
      // The worlds' files are read once, for this, and left as they are.
      const worlds = new CharacterFiles(this.app);
      try {
        await worlds.load();
        const lastPlayed = lastPlayedOf(this.campaigns.entries());
        return mergeWorldCharacters(worlds.entries().map((stored) => ({ stored, lastPlayed: lastPlayed.get(stored.id) ?? 0 })));
      } finally {
        worlds.destroy();
      }
    });
  }
}
