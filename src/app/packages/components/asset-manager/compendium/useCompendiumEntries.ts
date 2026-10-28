import { useEffect, useMemo, useState } from 'react';
import type { App, EventRef } from 'obsidian';
import { compendiumEntries, type CompendiumBook, type CompendiumEntry, type NoteFacts } from '../../../../compendium/compendiumEntries';
import { COMPENDIUM_ROOT } from '../../../../compendium/sourceFormat';

/** How long the list waits for a burst of vault changes to end, such as a source being installed. */
const SETTLE_MS = 200;

function compendiumNotes(app: App): NoteFacts[] {
  const prefix = `${COMPENDIUM_ROOT}/`;
  const notes: NoteFacts[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    notes.push({ path: file.path, frontmatter: app.metadataCache.getFileCache(file)?.frontmatter });
  }
  return notes;
}

/**
 * The entries of `books`, read again once the vault's notes or their properties stop changing.
 * The metadata cache reads a new note after it is written, so a note's kind follows it.
 */
export function useCompendiumEntries(app: App, books: readonly CompendiumBook[]): CompendiumEntry[] {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let timer: number | null = null;
    const changed = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setRevision((value) => value + 1);
      }, SETTLE_MS);
    };
    const vaultRefs: EventRef[] = [app.vault.on('create', changed), app.vault.on('delete', changed), app.vault.on('rename', changed)];
    const metadataRef = app.metadataCache.on('changed', changed);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      for (const ref of vaultRefs) app.vault.offref(ref);
      app.metadataCache.offref(metadataRef);
    };
  }, [app]);

  // `revision` is not read: it reads the vault again after every change.
  return useMemo(() => compendiumEntries(books, compendiumNotes(app)), [app, books, revision]);
}
