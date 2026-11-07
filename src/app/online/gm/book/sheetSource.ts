import type { App } from 'obsidian';
import type { FoundNote } from '../../protocol/index.ts';
import { readSheetFile, editSheetFile, playerNoteFiles, sheetFile } from '../../../characterSheets/obsidian/sheetFiles.ts';
import type { SheetEdit } from '../../../characterSheets/sheetNote.ts';
import { QuestImages } from '../../../plugin/questImages';
import type { AssetStoring } from '../assets/assetUses.ts';
import { foundHandout, readPinNote } from '../pins/foundNotes.ts';
import type { ReadSheet } from './SheetShare.ts';

/**
 * Reads a character sheet note for its player: the sheet's values, and each linked note as a found note
 * is read, its text and images stored for players (`stored`; without it the notes go without them).
 * A linked compendium entry is no document: the player reads it as a compendium page (`tableCompendium`).
 */
export function sheetSource(app: App, stored?: AssetStoring): { read(path: string): Promise<ReadSheet | null>; write(path: string, edit: SheetEdit): Promise<boolean> } {
  const images = new QuestImages(app);
  return {
    async read(path) {
      const file = sheetFile(app, path);
      const sheet = file === null ? null : await readSheetFile(app, file);
      if (file === null || sheet === null) return null;
      const notes: FoundNote[] = [];
      const paths: string[] = [];
      for (const target of playerNoteFiles(app, sheet.playerNotes, file.path).documents) {
        const reading = await readPinNote(app, target.path, file.path).catch(() => null);
        if (reading === null) continue;
        const handout = await foundHandout(reading, images, stored);
        notes.push(handout.note);
        paths.push(target.path, ...handout.images);
      }
      return { sheet: { system: sheet.system.id, values: sheet.values }, notes, paths };
    },
    async write(path, edit) {
      const file = sheetFile(app, path);
      return file !== null && (await editSheetFile(app, file, edit)) !== null;
    },
  };
}
