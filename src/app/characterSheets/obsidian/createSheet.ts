import type { App, TFile } from 'obsidian';
import { ensureFolder } from '../../plugin/vaultFolders';
import { TokenStatblockLinkService } from '../../services/TokenStatblockLinkService';
import { freeNotePath, noteFileName } from '../../statblocks/notes/createStatblockNote';
import { DND5E_2024 } from '../dnd5e2024.ts';
import { newSheet } from '../sheetNote.ts';
import type { SheetSystem } from '../sheetSystem.ts';
import { writeValues } from './sheetFiles.ts';

/** Where new character sheets go. */
export const SHEET_FOLDER = 'Personnages';

export interface NewCharacterSheet {
  readonly name: string;
  /** The library token it is for: linked to the note, its art the note's `image`. */
  readonly tokenImagePath?: string | undefined;
  readonly system?: SheetSystem;
}

/** Creates a character sheet note (in `SHEET_FOLDER`) and links the token to it; the note. */
export async function createCharacterSheet(app: App, sheet: NewCharacterSheet): Promise<TFile> {
  const system = sheet.system ?? DND5E_2024;
  const name = sheet.name.trim() || 'Personnage';
  const folder = await ensureFolder(app, SHEET_FOLDER);
  const path = freeNotePath(app, folder, noteFileName(name));
  const file = await app.vault.create(path, '\nFiche de personnage d\'Atlas : ouvre-la avec « Ouvrir la fiche de personnage ».\n');
  await writeValues(app, file, system, newSheet(system, name));
  if (sheet.tokenImagePath !== undefined) {
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.image = sheet.tokenImagePath;
    });
    await TokenStatblockLinkService.getInstance(app).linkTokenToStatblock(sheet.tokenImagePath, file.path);
  }
  return file;
}
