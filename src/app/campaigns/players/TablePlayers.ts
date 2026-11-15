import type { App } from 'obsidian';
import { TableFile, type TableFileBlock } from '../TableFile';
import { isWritable, linkOf, readPlayers, type CampaignPlayer, type StoredPlayers } from './playersFile';
import { emptyTablePlayers, TABLE_PLAYERS_LAYOUT, TABLE_PLAYERS_PATH } from './tablePlayersFile';
import { NO_ASSIGNMENTS, readTokenAssignments, type TokenAssignments } from './tokenAssignments';

/** Why the table's players file cannot be changed: it is not read yet, cannot be read, or is of a later format. */
export type PlayersBlock = TableFileBlock;

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
export class TablePlayers extends TableFile<StoredPlayers> {
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
    super(app, { path: TABLE_PLAYERS_PATH, layout: TABLE_PLAYERS_LAYOUT, isWritable, empty: emptyTablePlayers });
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
}
