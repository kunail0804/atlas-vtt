import type { App, Plugin } from 'obsidian';
import { showNotice } from '../../ui/notice';
import type { ContextMenuEntry } from '../../react/components/context-menu/AtlasContextMenu';
import { runInBackground } from '../../utils/backgroundTask';
import { readNoteSheet } from '../sheetNote.ts';
import { CHARACTER_SHEET_VIEW_TYPE, CharacterSheetView, openCharacterSheet } from './CharacterSheetView.tsx';
import { createCharacterSheet } from './createSheet.ts';
import { isSheetNote } from './sheetFiles.ts';
import { SHEET_TEXT } from './sheetText.ts';

/** A library token as the sheet's entry points know it. */
export interface SheetToken {
  readonly name: string;
  readonly imagePath?: string | undefined;
  readonly statblockPath?: string | undefined;
}

/**
 * The token's sheet, opened: its linked note where that is a character sheet; a new sheet, linked
 * to it, where it has no statblock. A token linked to another statblock (a monster's) keeps it and
 * gets none. Returns whether a sheet was opened.
 */
export async function openOrCreateSheet(app: App, token: SheetToken): Promise<boolean> {
  if (isSheetNote(app, token.statblockPath)) {
    await openCharacterSheet(app, token.statblockPath!);
    return true;
  }
  if (token.statblockPath?.trim()) return false;
  try {
    const file = await createCharacterSheet(app, { name: token.name, tokenImagePath: token.imagePath });
    showNotice(SHEET_TEXT.created(token.name));
    await openCharacterSheet(app, file.path);
    return true;
  } catch (error) {
    console.error('Atlas: creating a character sheet', error);
    showNotice(SHEET_TEXT.createFailed);
    return false;
  }
}

/** "Open character sheet" for a token linked to one, "Create character sheet" for one without a statblock; null otherwise. */
export function characterSheetEntry(app: App, token: SheetToken): ContextMenuEntry | null {
  const linked = token.statblockPath?.trim() ? token.statblockPath : undefined;
  if (linked !== undefined && !isSheetNote(app, linked)) return null;
  if (linked === undefined && !token.imagePath) return null;
  return {
    type: 'item',
    label: linked !== undefined ? SHEET_TEXT.openSheet : SHEET_TEXT.createSheet,
    icon: 'scroll-text',
    onClick: () => runInBackground(openOrCreateSheet(app, token), 'Opening a character sheet'),
  };
}

/** After a statblock was linked: its sheet opens where the note is one. */
export function openSheetIfAny(app: App, path: string | null): void {
  if (path !== null && isSheetNote(app, path)) runInBackground(openCharacterSheet(app, path), 'Opening a character sheet');
}

/** Sheets for new player characters that have no statblock yet; the first opens. */
export async function sheetsForPlayerCharacters(app: App, tokens: readonly SheetToken[]): Promise<void> {
  const fresh = tokens.filter((token) => !token.statblockPath?.trim() && token.imagePath);
  for (const [index, token] of fresh.entries()) {
    if (index === 0) await openOrCreateSheet(app, token);
    else await createCharacterSheet(app, { name: token.name, tokenImagePath: token.imagePath }).catch((error: unknown) => console.error('Atlas: creating a character sheet', error));
  }
}

/** The sheet's view and commands. */
export function registerCharacterSheets(plugin: Plugin): void {
  plugin.registerView(CHARACTER_SHEET_VIEW_TYPE, (leaf) => new CharacterSheetView(leaf));
  plugin.addCommand({
    id: 'open-character-sheet',
    name: SHEET_TEXT.openSheetCommand,
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || readNoteSheet(plugin.app.metadataCache.getFileCache(file)?.frontmatter) === null) return false;
      if (!checking) runInBackground(openCharacterSheet(plugin.app, file.path), 'Opening a character sheet');
      return true;
    },
  });
  plugin.addCommand({
    id: 'new-character-sheet',
    name: SHEET_TEXT.newSheetCommand,
    callback: () => runInBackground((async () => {
      const file = await createCharacterSheet(plugin.app, { name: 'Nouveau personnage' });
      await openCharacterSheet(plugin.app, file.path);
    })(), 'Creating a character sheet'),
  });
}
