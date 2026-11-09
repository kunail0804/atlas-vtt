import type { App } from 'obsidian';
import type { FoundNote } from '../../protocol/index.ts';
import { QuestImages } from '../../../plugin/questImages';
import { noteFile } from '../../../sheets/characterTemplates';
import { playerNoteFiles, playerNoteLinks } from '../../../sheets/playerNotes';
import type { AssetStoring } from '../assets/assetUses.ts';
import { foundHandout, readPinNote } from '../pins/foundNotes.ts';
import type { ReadNotes } from './CharacterNotesShare.ts';

/**
 * Reads the notes a character note links for its player, each as a found note is read, its text and
 * images stored for players (`stored`; without it the notes go without them). A linked compendium
 * entry is no document: the player reads it as a compendium page (`tableCompendium`).
 */
export function characterNotesSource(app: App, stored?: AssetStoring): { read(path: string): Promise<ReadNotes> } {
  const images = new QuestImages(app);
  return {
    async read(path) {
      const file = noteFile(app, path);
      if (file === null) return { notes: [], paths: [] };
      const notes: FoundNote[] = [];
      const paths: string[] = [];
      const links = playerNoteLinks(app.metadataCache.getFileCache(file)?.frontmatter);
      for (const target of playerNoteFiles(app, links, file.path).documents) {
        const reading = await readPinNote(app, target.path, file.path).catch(() => null);
        if (reading === null) continue;
        const handout = await foundHandout(reading, images, stored);
        notes.push(handout.note);
        paths.push(target.path, ...handout.images);
      }
      return { notes, paths };
    },
  };
}
