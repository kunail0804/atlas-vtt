import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { CampaignFiles } from '../CampaignFiles';
import { CampaignPlayers } from './CampaignPlayers';
import { mergeWorldPlayers } from './playersMigration';
import { isWritable, linkOf, readPlayers, type CampaignPlayer, type StoredPlayers } from './playersFile';
import {
  emptyTablePlayers, readMigratedIds, TABLE_PLAYERS_ID, TABLE_PLAYERS_LAYOUT, TABLE_PLAYERS_PATH, type MigratedIds,
} from './tablePlayersFile';
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

const NO_IDS: MigratedIds = {};

/**
 * The players of the GM's online table (`tablePlayersFile.ts`): one file for the vault, whatever world
 * the table plays. One per app, opened by the plugin and released when it unloads. Before it is ready
 * the worlds' own players files are carried into it where the vault has none yet (`whenReady`).
 */
export class TablePlayers extends RecordFiles<StoredPlayers> {
  private static readonly instances = new WeakMap<App, TablePlayers>();
  private readying: Promise<void> | null = null;
  private ready = false;

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

  /**
   * Settles once the file was read and, where the vault had none, the worlds' players files were
   * carried into it (`mergeWorldPlayers`). A failed migration is logged and leaves the file as it is.
   */
  whenReady(): Promise<void> {
    return (this.readying ??= this.load()
      .then(() => this.carryWorldsIn())
      .catch((error: unknown) => console.error('[Atlas] Carrying the worlds\' players into the table\'s players file failed:', error))
      .finally(() => {
        this.ready = true;
        // Listeners that waited for the migration read the file now.
        this.changed();
      }));
  }

  /** Whether `whenReady` settled, so what the file holds is what the vault does. */
  isReady(): boolean {
    return this.ready;
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

  /**
   * What each player of each world is called in this file, by world id and the id the player had
   * there; empty where nothing was carried over. Whatever else the worlds keep by player id (books,
   * compendium shares) is carried over through it.
   */
  migratedIds(): MigratedIds {
    const stored = this.stored();
    return stored ? readMigratedIds(stored) : NO_IDS;
  }

  /** Why the file cannot be changed now, or null where it can. */
  blocked(): PlayersBlock | null {
    if (!this.ready) return 'loading';
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

  /**
   * Writes the worlds' players merged into this file, where the vault has none (not even one that
   * cannot be read) and some world has players to carry over. The worlds' files stay as they are, for
   * older versions of Atlas.
   */
  private async carryWorldsIn(): Promise<void> {
    const { adapter } = this.app.vault;
    const campaigns = CampaignFiles.forApp(this.app);
    const worlds = CampaignPlayers.forApp(this.app);
    if (campaigns === undefined || worlds === undefined || await adapter.exists(TABLE_PLAYERS_PATH)) return;
    await campaigns.load();
    await worlds.whenLoaded();
    const lastPlayed = new Map(campaigns.entries().map((campaign) => [campaign.id, campaign.lastPlayed]));
    const merged = mergeWorldPlayers(worlds.entries().map((stored) => {
      const played = lastPlayed.get(stored.id);
      return { stored, lastPlayed: typeof played === 'number' && Number.isFinite(played) ? played : 0 };
    }));
    // Another device's file may have arrived while the worlds were read: it is the same, or newer.
    if (merged === null || this.stored() !== undefined || await adapter.exists(TABLE_PLAYERS_PATH)) return;
    this.createAt(TABLE_PLAYERS_PATH, merged, (onDisk) => onDisk);
    await this.flush();
  }
}
