import type { App } from 'obsidian';
import { RecordFiles } from '../../services/recordFiles/RecordFiles';
import { PLAYERS_LAYOUT, type StoredPlayers } from './playersFile';

/**
 * The worlds' own players files (`playersFile.ts`), one per world folder that had online players
 * before the table's players moved into one file for the vault (`TablePlayers`). Atlas only reads
 * them, to carry them over; they stay on disk for older versions. One per app, opened by the plugin
 * and released when it unloads.
 */
export class CampaignPlayers extends RecordFiles<StoredPlayers> {
  private static readonly instances = new WeakMap<App, CampaignPlayers>();

  static open(app: App): CampaignPlayers {
    let files = CampaignPlayers.instances.get(app);
    if (!files) {
      files = new CampaignPlayers(app);
      CampaignPlayers.instances.set(app, files);
    }
    return files;
  }

  /** The app's campaign players once the plugin opened them; undefined before. */
  static forApp(app: App | undefined): CampaignPlayers | undefined {
    return app ? CampaignPlayers.instances.get(app) : undefined;
  }

  static release(app: App): void {
    CampaignPlayers.instances.get(app)?.destroy();
    CampaignPlayers.instances.delete(app);
  }

  private constructor(app: App) {
    super(app, PLAYERS_LAYOUT);
  }

  /** Settles once the players files were read. */
  whenLoaded(): Promise<void> {
    return this.load();
  }
}
