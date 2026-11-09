import React, { type ReactElement } from 'react';
import { FuzzySuggestModal, type App, type TFile } from 'obsidian';
import { MAX_PLAYER_NOTES } from '../online/protocol/characterNotes.ts';
import { linkedNote, noteLink, setPlayerNotes } from './playerNotes';
import { SHEET_TEXT } from './sheetText';

/** Picks a Markdown note of the vault. */
class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly picked: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(SHEET_TEXT.pickNote);
  }
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }
  getItemText(file: TFile): string {
    return file.path;
  }
  onChooseItem(file: TFile): void {
    this.picked(file);
  }
}

/** The notes linked for the character's player (`atlas-player-notes`): each opened or taken off, and more linked from the vault. */
export function SheetDocuments({ app, file, links }: { app: App; file: TFile; links: readonly string[] }): ReactElement {
  const write = (next: readonly string[]): void => {
    setPlayerNotes(app, file, next).catch((error: unknown) => console.error('[SheetDocuments] Linking the notes failed:', error));
  };
  const add = (): void => new NotePicker(app, (picked) => write([...links, noteLink(app, picked, file.path)])).open();
  return (
    <div className="atlas-sheet-page atlas-sheet-player-notes">
      <p className="atlas-sheet-hint">{SHEET_TEXT.notesHint}</p>
      {links.length === 0 && <p className="atlas-sheet-hint">{SHEET_TEXT.noNotes}</p>}
      {links.map((link) => {
        const target = linkedNote(app, link, file.path);
        return (
          <div key={link} className="atlas-sheet-book-actions">
            <span>{target?.basename ?? `${link} ${SHEET_TEXT.missing}`}</span>
            {target !== null && <button type="button" className="atlas-sheet-add" onClick={() => void app.workspace.getLeaf('tab').openFile(target)}>{SHEET_TEXT.open}</button>}
            <button type="button" className="atlas-sheet-add" onClick={() => write(links.filter((entry) => entry !== link))}>{SHEET_TEXT.unlink}</button>
          </div>
        );
      })}
      {links.length < MAX_PLAYER_NOTES && <button type="button" className="atlas-sheet-add" onClick={add}>{SHEET_TEXT.linkNote}</button>}
    </div>
  );
}
