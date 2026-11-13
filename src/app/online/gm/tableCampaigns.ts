import type { App } from 'obsidian';
import { CampaignPlay } from '../../campaigns/campaignPlay';
import { TablePlayers } from '../../campaigns/players/TablePlayers';
import { TableSeats } from './campaignSeats.ts';
import type { SavedTable } from './savedTable.ts';

/**
 * The worlds an online table may play, and the table's players, as `OnlineControl` needs them. A
 * table runs with or without a world: the world it plays is the one this device plays, chosen by the
 * GM at the start and changed during the session.
 */
export interface TableCampaigns {
  /** The id of the campaign this device plays, or null. */
  playing(): string | null;
  /** This device plays the campaign `campaignId` from now on. */
  play(campaignId: string): void;
  /** This device plays no campaign from now on. */
  stop(): void;
  /** Calls `listener` whenever another campaign, or none, is played; returns the way to stop. */
  onChange(listener: () => void): () => void;
  /**
   * The table's players once their file is ready and what an older Atlas kept is carried into it,
   * read by the ids of the world `campaignId` the table plays (null: none); null where there are
   * none to read.
   */
  open(campaignId: string | null): Promise<TableSeats | null>;
  /** The table's players as read so far, without waiting; null where none can be read yet. */
  known(): TableSeats | null;
  /** A table runs from now on (`true`), or none runs any more (`false`). */
  bound(running: boolean): void;
}

/** The table's players while a table runs or comes back (`seated`), as read so far; null otherwise, or while none can be read yet. */
export function tableSeats(campaigns: TableCampaigns, seated: () => boolean): () => TableSeats | null {
  return () => (seated() ? campaigns.known() : null);
}

/**
 * What this device plays once online play has read its data: the world of the table that comes back
 * after a reload (played until then, so its rules hold while it reconnects), or none, also for a
 * table that comes back without a world. Older Atlas versions let the GM play a campaign without a
 * table; such a play ends here.
 */
export function playSavedTable(campaigns: TableCampaigns, saved: SavedTable | null): void {
  const world = saved?.campaignId ?? null;
  if (world === null) campaigns.stop();
  else campaigns.play(world);
}

/**
 * The vault's campaigns: the one this device plays, and the table's players file (`TablePlayers`).
 * `prepare` readies the table's files before a table runs, played on a world or none (its failure is
 * logged, and the table runs).
 */
export function appCampaigns(app: App, bound: (running: boolean) => void = () => undefined, prepare: (campaignId: string | null) => Promise<void> = () => Promise.resolve()): TableCampaigns {
  return {
    playing: () => CampaignPlay.forApp(app).playing(),
    play: (campaignId) => CampaignPlay.forApp(app).play(campaignId),
    stop: () => CampaignPlay.forApp(app).stop(),
    onChange: (listener) => CampaignPlay.forApp(app).onChange(listener),
    open: async (campaignId) => {
      const players = TablePlayers.forApp(app);
      if (players === undefined) return null;
      await players.whenReady();
      await prepare(campaignId).catch((error: unknown) => console.error('[Atlas] Readying the table\'s files failed:', error));
      return new TableSeats(players);
    },
    known: () => {
      const players = TablePlayers.forApp(app);
      return players === undefined || !players.isReady() ? null : new TableSeats(players);
    },
    bound,
  };
}
