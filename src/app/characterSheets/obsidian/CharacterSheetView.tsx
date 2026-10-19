import React, { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FuzzySuggestModal, ItemView, TFile, type App, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { rollStatblockDice } from '../../services/statblockRolls';
import { CharacterSheet } from '../CharacterSheet.tsx';
import type { SheetRow, SheetValue } from '../sheetFields.ts';
import { applySheetEdit, type NoteSheet, type SheetEdit } from '../sheetNote.ts';
import { MAX_PLAYER_NOTES } from '../sheetSystem.ts';
import { SHEET_SYSTEMS } from '../sheetSystems.ts';
import { editSheetFile, linkedNote, noteLink, readSheetFile, setPlayerNotes, setSheetSystem, sheetFile } from './sheetFiles.ts';
import { SheetBook } from './SheetBook.tsx';
import { SHEET_TEXT } from './sheetText.ts';

export const CHARACTER_SHEET_VIEW_TYPE = 'atlas-character-sheet';

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

/** The notes linked for the character's player: each opened or taken off, and more linked from the vault. */
function PlayerNotes({ app, file, links }: { app: App; file: TFile; links: readonly string[] }): ReactElement {
  const add = (): void => new NotePicker(app, (picked) => {
    void setPlayerNotes(app, file, [...links, noteLink(app, picked, file.path)]);
  }).open();
  return (
    <div className="atlas-sheet-page atlas-sheet-player-notes">
      <p className="atlas-sheet-hint">{SHEET_TEXT.notesHint}</p>
      {links.length === 0 && <p className="atlas-sheet-hint">{SHEET_TEXT.noNotes}</p>}
      {links.map((link) => {
        const target = linkedNote(app, link, file.path);
        return (
          <div key={link} className="atlas-sheet-note-row">
            <span className="atlas-sheet-note-title">{target?.basename ?? `${link} ${SHEET_TEXT.missing}`}</span>
            {target !== null && <button type="button" className="atlas-sheet-add" onClick={() => void app.workspace.getLeaf('tab').openFile(target)}>{SHEET_TEXT.open}</button>}
            <button type="button" className="atlas-sheet-add" onClick={() => void setPlayerNotes(app, file, links.filter((entry) => entry !== link))}>{SHEET_TEXT.unlink}</button>
          </div>
        );
      })}
      {links.length < MAX_PLAYER_NOTES && <button type="button" className="atlas-sheet-add" onClick={add}>{SHEET_TEXT.linkNote}</button>}
    </div>
  );
}

/**
 * The GM's sheet of a note: what is typed shows at once and is written into the note, one write after
 * another; the note read again whenever it changes (an edit in the note, a player's edit at the table),
 * except while a write of this sheet is under way, whose own echo would move what is being typed.
 */
export function SheetEditor({ app, file }: { app: App; file: TFile }): ReactElement {
  const [sheet, setSheet] = useState<NoteSheet | null | undefined>(undefined);
  const pending = useRef(0);
  const reload = useCallback(() => {
    if (pending.current > 0) return;
    void readSheetFile(app, file).then(setSheet);
  }, [app, file]);
  useEffect(() => {
    reload();
    const ref = app.metadataCache.on('changed', (changed) => {
      if (changed.path === file.path) reload();
    });
    return () => app.metadataCache.offref(ref);
  }, [app, file, reload]);

  if (sheet === undefined) return <p className="atlas-sheet-hint">{SHEET_TEXT.loading}</p>;
  if (sheet === null) return <p className="atlas-sheet-hint">{SHEET_TEXT.notASheet}</p>;
  const edit = (change: SheetEdit): void => {
    const values = applySheetEdit(sheet.system, sheet.values, change);
    if (values === null) return;
    setSheet({ ...sheet, values });
    pending.current += 1;
    void editSheetFile(app, file, change).finally(() => {
      pending.current -= 1;
      reload();
    });
  };
  const switchSystem = (id: string): void => {
    pending.current += 1;
    void setSheetSystem(app, file, id).finally(() => {
      pending.current -= 1;
      reload();
    });
  };
  const roll = (formula: string, label: string): void => {
    const name = typeof sheet.values.name === 'string' ? sheet.values.name : file.basename;
    if (rollStatblockDice(app, formula, { statblockPath: file.path, abilityName: label, tokenName: name }) === null) showNotice(SHEET_TEXT.noMap);
  };
  return (
    <>
      {/* Only the GM picks the rules a sheet follows: the player's page has no such choice. */}
      <label className="atlas-sheet-rules">
        <span className="atlas-sheet-label">{SHEET_TEXT.rules}</span>
        <select className="atlas-sheet-input" aria-label={SHEET_TEXT.rules} value={sheet.system.id} onChange={(event) => switchSystem(event.target.value)}>
          {SHEET_SYSTEMS.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
      </label>
      <CharacterSheet system={sheet.system.id} values={sheet.values} editable
      onSet={(key: string, value: SheetValue) => edit({ op: 'set', key, value })}
      onRow={(key: string, index: number, row: SheetRow | null) => edit({ op: 'row', key, index, row })}
      onRoll={roll}
      notes={<PlayerNotes app={app} file={file} links={sheet.playerNotes} />}
      book={<SheetBook app={app} file={file} />} />
    </>
  );
}

/** A character sheet in its own tab: the note's sheet, filled in as a form. */
export class CharacterSheetView extends ItemView {
  private path: string | null = null;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHARACTER_SHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    const file = this.path === null ? null : sheetFile(this.app, this.path);
    return file === null ? SHEET_TEXT.title : `${SHEET_TEXT.title} : ${file.basename}`;
  }

  getIcon(): string {
    return 'scroll-text';
  }

  getState(): Record<string, unknown> {
    return { file: this.path };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = typeof state === 'object' && state !== null && 'file' in state ? (state).file : null;
    this.path = typeof file === 'string' ? file : null;
    this.render();
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('atlas-vtt-plugin', 'atlas-sheet-view');
    this.root = createRoot(this.contentEl);
    this.render();
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath === this.path) {
        this.path = file.path;
        this.render();
      }
    }));
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private render(): void {
    const file = this.path === null ? null : sheetFile(this.app, this.path);
    this.root?.render(file === null ? <p className="atlas-sheet-hint">{SHEET_TEXT.noFile}</p> : <SheetEditor key={file.path} app={this.app} file={file} />);
  }
}

/** Opens a note's sheet: in the tab already showing it, else in a new tab. */
export async function openCharacterSheet(app: App, path: string): Promise<void> {
  const open = app.workspace.getLeavesOfType(CHARACTER_SHEET_VIEW_TYPE).find((leaf) => (leaf.view.getState() as { file?: unknown }).file === path);
  const leaf = open ?? app.workspace.getLeaf('tab');
  await leaf.setViewState({ type: CHARACTER_SHEET_VIEW_TYPE, active: true, state: { file: path } });
  await app.workspace.revealLeaf(leaf);
}
