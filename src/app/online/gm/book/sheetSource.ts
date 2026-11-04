import type { App } from 'obsidian';
import type { FoundNote } from '../../protocol/index.ts';
import { readSheetFile, editSheetFile, linkedNote, sheetFile } from '../../../characterSheets/obsidian/sheetFiles.ts';
import type { SheetEdit } from '../../../characterSheets/sheetNote.ts';
import { QuestImages } from '../../../plugin/questImages';
import type { AssetStoring } from '../assets/assetUses.ts';
import { foundHandout, readPinNote } from '../pins/foundNotes.ts';
import type { ReadSheet } from './SheetShare.ts';

/**
 * Reads a character sheet note for its player: the sheet's values, and each linked note as a found note
 * is read, its text and images stored for players (`stored`; without it the notes go without them).
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
      for (const link of sheet.playerNotes) {
        const target = linkedNote(app, link, file.path);
        const reading = target === null ? null : await readPinNote(app, target.path, file.path).catch(() => null);
        if (target === null || reading === null) continue;
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
