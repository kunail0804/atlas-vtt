import type { Plugin } from 'obsidian';
import { PartySync } from '../campaigns/partyValues/PartySync';
import { TableCharacters } from '../campaigns/partyValues/TableCharacters';
import { AssetService } from '../services/AssetService';

/**
 * Opens the app's `PartySync` before the views, so every restored map view joins it. It starts
 * once the campaigns and the table's characters file are read, follows changes of which library tokens
 * are player characters, and writes what waits when the plugin unloads.
 */
export function registerPartySync(plugin: Plugin, campaignsRead: Promise<void>): void {
  const { app } = plugin;
  const characters = new TableCharacters(app);
  const assets = AssetService.getInstance(app);
  const sync = new PartySync({
    characters,
    tokens: () => assets.loadedTokenAssets(),
    ready: campaignsRead.then(() => characters.load()),
  });
  PartySync.register(app, sync);
  plugin.registerEvent(app.workspace.on('atlas-vtt:refresh-assets', () => sync.charactersChanged()));
  // The library's tokens are known once its index is read, after the storage is ready.
  void campaignsRead.then(() => assets.initialize()).then(() => sync.charactersChanged(), () => undefined);
  plugin.register(() => {
    PartySync.release(app);
    characters.destroy();
  });
}
