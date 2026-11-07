import type { App } from 'obsidian';
import { showNotice } from '../ui/notice';
import { FORMER_SHEET_KEY, migratedSheet } from './sheetMigration';
import { SHEET_TEXT } from './sheetText';

/**
 * Moves every character sheet of the former engine onto the 5E character template, in place: the
 * note keeps its path, its body, its links and every key the move does not touch. Tells the GM how
 * many moved. Nothing is done for a vault that holds none, so it runs at every start.
 */
export async function migrateCharacterSheets(app: App): Promise<number> {
  const files = app.vault.getMarkdownFiles().filter((file) => app.metadataCache.getFileCache(file)?.frontmatter?.[FORMER_SHEET_KEY] !== undefined);
  let moved = 0;
  for (const file of files) {
    try {
      let done = false;
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const migrated = migratedSheet(frontmatter);
        if (migrated === null) return;
        for (const key of migrated.remove) delete frontmatter[key];
        Object.assign(frontmatter, migrated.set);
        done = true;
      });
      if (done) moved += 1;
    } catch (error) {
      console.error(`Atlas: moving the character sheet ${file.path} onto the statblock template`, error);
    }
  }
  if (moved > 0) showNotice(SHEET_TEXT.migrated(moved));
  return moved;
}
