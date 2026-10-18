import type { App } from 'obsidian';
import type { FoundNote } from '../../protocol/index.ts';
import { readSheetFile, editSheetFile, linkedNote, sheetFile } from '../../../characterSheets/obsidian/sheetFiles.ts';
import type { SheetEdit } from '../../../characterSheets/sheetNote.ts';
import { QuestImages } from '../../../plugin/questImages';
import { foundHandout, readPinNote } from '../pins/foundNotes.ts';
import type { ReadSheet } from './SheetShare.ts';

/** Reads a character sheet note for its player: the sheet's values, and each linked note as a found note is read. */
export function sheetSource(app: App): { read(path: string): Promise<ReadSheet | null>; write(path: string, edit: SheetEdit): Promise<boolean> } {
  const images = new QuestImages(app);
  return {
    async read(path) {
      const file = sheetFile(app, path);
      const sheet = file === null ? null : await readSheetFile(app, file);
      if (file === null || sheet === null) return null;
      const notes: FoundNote[] = [];
      const paths: string[] = [];
      const texts = new Map<string, Uint8Array<ArrayBuffer>>();
      const shown = new Map<string, string>();
      for (const link of sheet.playerNotes) {
        const target = linkedNote(app, link, file.path);
        const reading = target === null ? null : await readPinNote(app, target.path, file.path).catch(() => null);
        if (target === null || reading === null) continue;
        const handout = await foundHandout(reading, images);
        notes.push(handout.note);
        paths.push(target.path);
        if (handout.text !== null) texts.set(handout.text.ref.hash, handout.text.bytes);
        for (const [hash, image] of handout.images) shown.set(hash, image);
      }
      return { sheet: { system: sheet.system.id, values: sheet.values }, notes, paths, texts, images: shown };
    },
    async write(path, edit) {
      const file = sheetFile(app, path);
      return file !== null && (await editSheetFile(app, file, edit)) !== null;
    },
  };
}
