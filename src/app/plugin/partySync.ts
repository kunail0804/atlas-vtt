import type { Plugin } from 'obsidian';
import { PartySync } from '../campaigns/partyValues/PartySync';
import { TableCharacters } from '../campaigns/partyValues/TableCharacters';
import { warnWhenUnreadable } from '../campaigns/tableFileWarning';
import { AssetService } from '../services/AssetService';

/**
 * Opens the app's `PartySync` before the views, so every restored map view joins it. It starts
 * once the campaigns were read (or reading them failed) and the table's characters file is read,
 * follows changes of which library tokens are player characters, warns the GM where that file
 * cannot be read, and writes what waits when the plugin unloads.
 */
export function registerPartySync(plugin: Plugin, campaignsRead: Promise<void>): void {
  const { app } = plugin;
  const characters = new TableCharacters(app);
  const assets = AssetService.getInstance(app);
  // The characters file belongs to no world: it is read whether or not the worlds could be.
  const worldsSettled = campaignsRead.catch(() => undefined);
  const sync = new PartySync({
    characters,
    tokens: () => assets.loadedTokenAssets(),
    ready: worldsSettled.then(() => characters.load()),
  });
  plugin.register(warnWhenUnreadable(characters));
  PartySync.register(app, sync);
  plugin.registerEvent(app.workspace.on('atlas-vtt:refresh-assets', () => sync.charactersChanged()));
  // The library's tokens are known once its index is read, after the storage is ready.
  void worldsSettled.then(() => assets.initialize()).then(() => sync.charactersChanged(), () => undefined);
  plugin.register(() => {
    PartySync.release(app);
    characters.destroy();
  });
}
