import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { isWritable, linkOf, readPlayers, type CampaignPlayer, type StoredPlayers } from './playersFile';
import { emptyTablePlayers, TABLE_PLAYERS_ID, TABLE_PLAYERS_LAYOUT, TABLE_PLAYERS_PATH } from './tablePlayersFile';
import { NO_ASSIGNMENTS, readTokenAssignments, type TokenAssignments } from './tokenAssignments';

/** Why the table's players file cannot be changed: it is not read yet, or it is of a later format. */
export type PlayersBlock = 'loading' | 'newer';

/** What the table's players file holds, as Atlas reads it. */
export interface PlayersRoster {
  /** The table's code, once it has one. */
  readonly link: string | null;
  readonly players: readonly CampaignPlayer[];
  /** False for a file of a later format, which is only read. */
  readonly writable: boolean;
}

/**
 * The players of the GM's online table (`tablePlayersFile.ts`): one file for the vault, whatever world
 * the table plays. One per app, opened by the plugin and released when it unloads; read with `load`.
 */
export class TablePlayers extends RecordFiles<StoredPlayers> {
  private static readonly instances = new WeakMap<App, TablePlayers>();

  static open(app: App): TablePlayers {
    let files = TablePlayers.instances.get(app);
    if (!files) {
      files = new TablePlayers(app);
      TablePlayers.instances.set(app, files);
    }
    return files;
  }

  /** The app's table players once the plugin opened them; undefined before. */
  static forApp(app: App | undefined): TablePlayers | undefined {
    return app ? TablePlayers.instances.get(app) : undefined;
  }

  static release(app: App): void {
    TablePlayers.instances.get(app)?.destroy();
    TablePlayers.instances.delete(app);
  }

  private constructor(app: App) {
    super(app, TABLE_PLAYERS_LAYOUT);
  }

  /** The table's link and players; none while it has no file. */
  roster(): PlayersRoster {
    const stored = this.stored();
    return stored ? { link: linkOf(stored), players: readPlayers(stored), writable: isWritable(stored) } : { link: null, players: [], writable: true };
  }

  /** The tokens the file assigns (`tokenAssignments.ts`); none while it has no file. */
  assignments(): TokenAssignments {
    const stored = this.stored();
    return stored ? readTokenAssignments(stored) : NO_ASSIGNMENTS;
  }

  /** Why the file cannot be changed now, or null where it can. */
  blocked(): PlayersBlock | null {
    if (!this.isLoaded()) return 'loading';
    const stored = this.stored();
    return stored !== undefined && !isWritable(stored) ? 'newer' : null;
  }

  /**
   * Changes the file, creating it when the vault has none. False where it cannot be changed
   * (`blocked`). `change` must be a pure function of the file it is given: it runs more than once,
   * on the copy in memory now and on what the disk holds once the write lands, so anything random or
   * timed is drawn before and passed in.
   */
  change(change: (stored: StoredPlayers) => StoredPlayers): boolean {
    if (this.blocked() !== null) return false;
    if (this.stored() !== undefined) this.update(TABLE_PLAYERS_ID, change);
    else this.createAt(TABLE_PLAYERS_PATH, change(emptyTablePlayers()), change);
    return true;
  }

  private stored(): StoredPlayers | undefined {
    return this.entries().find((entry) => entry.id === TABLE_PLAYERS_ID);
  }
}
