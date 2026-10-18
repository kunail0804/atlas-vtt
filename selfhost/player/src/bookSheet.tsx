import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CharacterSheet } from '../../../src/app/characterSheets/CharacterSheet.tsx';
import type { SheetRow, SheetValue, SheetValues } from '../../../src/app/characterSheets/sheetFields.ts';
import { applySheetEdit, type SheetEdit } from '../../../src/app/characterSheets/sheetNote.ts';
import { sheetSystem } from '../../../src/app/characterSheets/sheetSystems.ts';
import type { BookCharacter } from '../../../src/app/online/protocol/book.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { FoundNote } from '../../../src/app/online/protocol/logShown.ts';
import type { SheetEditValue, SheetMessage } from '../../../src/app/online/protocol/sheet.ts';
import { button, node } from './bookDom.ts';
import { TEXT } from './text.ts';

/** How long the page waits after the last change of a field before it sends it: one message per pause in typing. */
const SEND_AFTER_MS = 350;
/** How long a sent change outweighs what the GM sends back, which may be older. */
const HOLD_MS = 2_000;

export interface SheetPorts {
  readonly send: (message: PlayerMessage) => void;
  /** Rolls a formula for the character, named by what it rolls. */
  readonly roll: (formula: string, label: string) => void;
  /** Sets the character's own hit points (their token's), as the book's sheet page does. */
  readonly setHitPoints: (current: number) => void;
  readonly openNote: (note: FoundNote) => void;
}

/**
 * The player's character sheet and the notes the GM linked to it. The sheet is drawn by the plugin's
 * own sheet (`CharacterSheet`), kept in one React root across redraws so what is typed and the focus
 * stay; a change shows at once, by the sheet's own rules, and goes to the GM once the typing pauses.
 * What the GM sends back does not undo a change of the last moments, which may not have reached it.
 */
export class BookSheet {
  private readonly host: HTMLElement;
  private readonly root: Root;
  private readonly ports: SheetPorts;
  private sheet: SheetMessage['sheet'] = null;
  private notes: readonly FoundNote[] = [];
  private received = false;
  /** Changes not sent yet, by field (a table's rows by field and row). */
  private readonly waiting = new Map<string, { edit: SheetEdit; timer: number }>();
  /** Fields changed in the last moments, and until when they outweigh the GM's values. */
  private readonly held = new Map<string, { value: SheetValue; until: number }>();
  private character: BookCharacter | null = null;

  constructor(ports: SheetPorts) {
    this.ports = ports;
    this.host = node('div', 'book-page book-sheet');
    this.root = createRoot(this.host);
  }

  receive(message: SheetMessage): void {
    this.received = true;
    this.notes = message.notes;
    if (message.sheet === null) {
      this.sheet = null;
      return this.draw();
    }
    const now = Date.now();
    const values: Record<string, SheetValue> = { ...message.sheet.values };
    for (const [key, held] of this.held) {
      if (held.until < now) this.held.delete(key);
      else values[key] = held.value;
    }
    this.sheet = { system: message.sheet.system, values };
    this.draw();
  }

  /** The character's sheet of the book (its hit points), as the GM last sent it. */
  setCharacter(character: BookCharacter | null): void {
    this.character = character;
    this.draw();
  }

  /** The sheet page: the same element every time, so the sheet keeps its state. */
  sheetPage(): HTMLElement {
    this.draw();
    return this.host;
  }

  /** The notes the GM linked for the player, each opened in the reader. */
  documentsPage(): HTMLElement {
    const page = node('div', 'book-page');
    if (this.notes.length === 0) page.append(node('p', 'book-empty', TEXT.sheet.noDocuments));
    for (const note of this.notes) {
      const card = node('article', 'book-note book-document');
      card.append(node('h3', 'book-item-name', note.title));
      if (note.body !== '') card.append(node('p', 'book-text', note.body.length > 220 ? `${note.body.slice(0, 220)}…` : note.body));
      card.append(button(TEXT.sheet.read, () => this.ports.openNote(note)));
      page.append(card);
    }
    return page;
  }

  private edit(edit: SheetEdit, value: SheetValue | null): void {
    const sheet = this.sheet;
    const system = sheet === null ? null : sheetSystem(sheet.system);
    if (sheet === null || system === null) return;
    const values: SheetValues | null = applySheetEdit(system, sheet.values, edit);
    if (values === null) return;
    this.sheet = { ...sheet, values };
    this.held.set(edit.key, { value: values[edit.key] ?? value ?? '', until: Date.now() + HOLD_MS });
    const slot = edit.op === 'set' ? edit.key : `${edit.key}#${edit.index}`;
    const before = this.waiting.get(slot);
    if (before !== undefined) window.clearTimeout(before.timer);
    // A row taken out or added goes at once: the indexes of what follows depend on it.
    if (edit.op === 'row' && (edit.row === null || before === undefined)) {
      this.waiting.delete(slot);
      this.flush(edit);
    } else {
      this.waiting.set(slot, { edit, timer: window.setTimeout(() => {
        this.waiting.delete(slot);
        this.flush(edit);
      }, SEND_AFTER_MS) });
    }
    this.draw();
  }

  private flush(edit: SheetEdit): void {
    if (edit.op === 'set') this.ports.send({ t: 'sheet-edit', key: edit.key, value: edit.value as SheetEditValue });
    else this.ports.send({ t: 'sheet-row', key: edit.key, index: edit.index, row: edit.row as Record<string, string | number | boolean> | null });
  }

  private draw(): void {
    const sheet = this.sheet;
    if (sheet === null) {
      this.root.render(<p className="book-empty">{this.received ? TEXT.sheet.none : TEXT.sheet.coming}</p>);
      return;
    }
    const hp = this.character?.resources.find((resource) => resource.key === 'hp');
    this.root.render(
      <div className="atlas-vtt-plugin">
        <CharacterSheet system={sheet.system} values={sheet.values} editable
          onSet={(key: string, value: SheetValue) => this.edit({ op: 'set', key, value }, value)}
          onRow={(key: string, index: number, row: SheetRow | null) => this.edit({ op: 'row', key, index, row }, null)}
          onRoll={(formula, label) => this.ports.roll(formula, label)}
          hitPoints={hp === undefined ? undefined : { current: hp.current, max: hp.max, ...(hp.editable && { set: (current: number) => this.ports.setHitPoints(current) }) }} />
      </div>,
    );
  }
}
