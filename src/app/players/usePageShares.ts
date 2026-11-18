import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { App } from 'obsidian';
import { TablePlayers } from '../campaigns/players/TablePlayers';
import type { CampaignPlayer } from '../campaigns/players/playersFile';
import { PageShares } from './PageShares';
import type { PageShares as Shares } from './shares';

/** The compendium pages shared with the players of the table, followed as they change; read from the vault once. */
export function usePageShares(app: App): { shares: Shares; service: PageShares } {
  const service = PageShares.forApp(app);
  useEffect(() => { void service.load(); }, [service]);
  const shares = useSyncExternalStore(useCallback((listener: () => void) => service.onChange(listener), [service]), () => service.current());
  return { shares, service };
}

/** The players of the table (`TablePlayers`), by name, followed as the file changes; none before the plugin opened it. */
export function useTablePlayers(app: App): readonly CampaignPlayer[] {
  const read = useCallback((): readonly CampaignPlayer[] => [...(TablePlayers.forApp(app)?.roster().players ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [app]);
  const [players, setPlayers] = useState(read);
  useEffect(() => {
    const files = TablePlayers.forApp(app);
    if (files === undefined) return undefined;
    setPlayers(read());
    return files.onChange(() => setPlayers(read()));
  }, [app, read]);
  return players;
}
