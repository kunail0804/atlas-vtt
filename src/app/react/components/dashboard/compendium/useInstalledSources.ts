import { useCallback, useEffect, useState } from 'react';
import type { App } from 'obsidian';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import type { InstalledSource } from '../../../../compendium/installedSources';

export interface InstalledSources {
  /** Undefined until the install records were read. */
  sources: InstalledSource[] | undefined;
  reload: () => void;
}

/** The vault's installed compendium sources, read again after every install or removal. */
export function useInstalledSources(app: App): InstalledSources {
  const [sources, setSources] = useState<InstalledSource[] | undefined>(undefined);
  const service = CompendiumService.forApp(app);

  const reload = useCallback((): void => {
    service.installed().then(setSources, (error: unknown) => {
      console.error('[useInstalledSources] Reading the installed sources failed:', error);
      setSources([]);
    });
  }, [service]);

  useEffect(() => {
    reload();
    return service.onChange(reload);
  }, [service, reload]);

  return { sources, reload };
}
