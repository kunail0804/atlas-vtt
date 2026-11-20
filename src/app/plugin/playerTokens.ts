import type { Plugin } from 'obsidian';
import type { TablePlayers } from '../campaigns/players/TablePlayers';
import { givenTokens } from '../campaigns/players/givenTokens';
import { KnownPlayerTokens } from '../characters/knownPlayerTokens';
import { setPlayerTokenSource } from '../characters/playerTokens';
import { AssetService } from '../services/AssetService';

/**
 * Tells the app which tokens are the players' whatever they hold themselves (`isPlayersToken`): the
 * library's player characters and what the players of the online table were given. The table's
 * players belong to the vault, whatever world is played. It reads them again when the library or
 * the table's players change, and knows the library once its index is read.
 */
export function registerPlayerTokens(plugin: Plugin, players: TablePlayers, campaignsRead: Promise<void>): void {
  const { app } = plugin;
  const assets = AssetService.getInstance(app);
  const known = new KnownPlayerTokens({
    library: () => assets.loadedTokenAssets(),
    given: () => (players.isLoaded() ? givenTokens(players.roster().players, players.assignments()) : null),
  });
  const changed = (): void => known.changed();
  setPlayerTokenSource(known);
  plugin.registerEvent(app.workspace.on('atlas-vtt:refresh-assets', changed));
  plugin.register(assets.onReconciled(changed));
  plugin.register(players.onChange(changed));
  void campaignsRead.catch(() => undefined).then(() => assets.initialize()).then(changed, () => undefined);
  plugin.register(() => setPlayerTokenSource(null));
}
