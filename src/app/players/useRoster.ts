import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { App } from 'obsidian';
import { PlayerRoster } from './PlayerRoster';
import type { Roster } from './roster';

/** The vault's players and their shares, followed as they change; read from the vault once. */
export function useRoster(app: App): { roster: Roster; service: PlayerRoster } {
  const service = PlayerRoster.forApp(app);
  useEffect(() => { void service.load(); }, [service]);
  const roster = useSyncExternalStore(useCallback((listener: () => void) => service.onChange(listener), [service]), () => service.current());
  return { roster, service };
}
