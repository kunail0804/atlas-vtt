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
  /** The table's players once their file was read; null where there are none to read. */
  open(): Promise<TableSeats | null>;
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

/** The vault's campaigns: the one this device plays, and the table's players file (`TablePlayers`). */
export function appCampaigns(app: App, bound: (running: boolean) => void = () => undefined): TableCampaigns {
  return {
    playing: () => CampaignPlay.forApp(app).playing(),
    play: (campaignId) => CampaignPlay.forApp(app).play(campaignId),
    stop: () => CampaignPlay.forApp(app).stop(),
    onChange: (listener) => CampaignPlay.forApp(app).onChange(listener),
    open: async () => {
      const players = TablePlayers.forApp(app);
      if (players === undefined) return null;
      await players.load();
      return new TableSeats(players);
    },
    known: () => {
      const players = TablePlayers.forApp(app);
      return players === undefined || !players.isLoaded() ? null : new TableSeats(players);
    },
    bound,
  };
}
