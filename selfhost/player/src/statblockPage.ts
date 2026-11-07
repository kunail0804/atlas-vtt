import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BookCharacter, BookRestAnswer, BookRestMessage, BookStatblock, PlayerBookMessage, SheetValue } from '../../../src/app/online/protocol/book.ts';
import type { FoundNote } from '../../../src/app/online/protocol/logShown.ts';
import type { SheetCompendium } from '../../../src/app/compendium/pickKinds.ts';
import { SheetCompendiumBar } from '../../../src/app/sheets/SheetCompendiumBar.tsx';
import type { AssetLoader } from './assets.ts';
import { node } from './bookDom.ts';
import { abilityElement } from './statblockAbilities.ts';
import type { StatblockContext, StatblockUi } from './statblockContext.ts';
import { nodeElement, nodesElements } from './statblockNodes.ts';
import { restsElement } from './statblockRests.ts';
import { valueElement } from './statblockValues.ts';
import './statblock.scss';
import { TEXT } from './text.ts';

/** What the statblock page needs from the book and the table. */
export interface StatblockPorts {
  readonly assets: AssetLoader;
  /** Sends a change of the statblock to the GM, checked as the GM reads it; false where it was not sent. */
  readonly write: (message: PlayerBookMessage) => boolean;
  readonly askRest: (message: BookRestMessage) => void;
  /** Rolls a formula for the character, named by what it rolls. */
  readonly roll: (formula: string, label: string) => void;
  readonly openNote: (note: FoundNote) => void;
  readonly tell: (text: string) => void;
  readonly redraw: () => void;
  /** The campaign's compendium, through the GM. */
  readonly compendium: SheetCompendium;
}

const SIGILS = ['hp', 'armor', 'level', 'type'] as const;

/**
 * The player's own character's statblock as the GM's Atlas draws it for them (`book-statblock`),
 * and the notes the GM linked to the character (`character-notes`). What the player changes goes to
 * the GM, who answers with the next statblock: the page shows what the GM holds, and keeps what is
 * being typed (`drafts`) until the value it was typed against changes.
 */
export class StatblockSheet {
  private statblock: BookStatblock | null = null;
  private received = false;
  private notes: readonly FoundNote[] = [];
  private character: BookCharacter | null = null;
  private readonly drafts = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  private readonly ui: StatblockUi = { tabs: new Map(), ability: null, rest: null, waiting: null };
  /** The compendium bar, one React root moved into every drawing of the page so its picker stays open. */
  private readonly barHost = node('div', 'atlas-vtt-plugin sb-compendium');
  private barRoot: Root | null = null;

  constructor(private readonly ports: StatblockPorts) {}

  receive(statblock: BookStatblock | null): void {
    this.received = true;
    this.statblock = statblock;
    // A rest's form belongs to the statblock it was opened on; a button gone takes it along.
    if (this.ui.rest !== null && !(statblock?.recovery ?? []).some((rest) => rest.id === this.ui.rest?.button)) this.ui.rest = null;
  }

  receiveNotes(notes: readonly FoundNote[]): void {
    this.notes = notes;
  }

  setCharacter(character: BookCharacter | null): void {
    this.character = character;
  }

  /** The GM's answer to the rest the page asked for. */
  receiveRestAnswer(answer: BookRestAnswer): void {
    if (answer.request !== this.ui.waiting) return;
    this.ui.waiting = null;
    this.ports.tell(TEXT.sheet.rests.answers[answer.outcome]);
  }

  /** The notes the GM linked for the player, each opened in the reader. */
  documents(): readonly { readonly title: string; readonly open: () => void }[] {
    return this.notes.map((note) => ({ title: note.title, open: () => this.ports.openNote(note) }));
  }

  page(): HTMLElement {
    const page = node('div', 'book-page sb-page');
    const statblock = this.statblock;
    if (statblock === null) {
      page.append(node('p', 'book-empty', this.received ? TEXT.sheet.none : TEXT.sheet.coming));
      return page;
    }
    const context = this.context(statblock);
    if (context.editable) page.append(this.compendiumBar());
    else page.append(node('p', 'book-empty', TEXT.sheet.readOnly));
    page.append(this.header(context));
    const rests = restsElement(context);
    if (rests !== null) page.append(rests);
    const blocks = node('div', 'sb-blocks');
    if (statblock.card !== undefined) {
      blocks.style.setProperty('--sb-column', `${statblock.card.columnWidth}em`);
      blocks.style.setProperty('--sb-columns', String(statblock.card.maxColumns));
    }
    blocks.append(...nodesElements(context, statblock.blocks, 'block'), ...statblock.abilities.map((component) => abilityElement(context, component)));
    page.append(blocks);
    for (const key of [...this.drafts.keys()]) if (!context.used.has(key) && !key.startsWith('ability.')) this.drafts.delete(key);
    return page;
  }

  private context(statblock: BookStatblock): StatblockContext {
    const { write, askRest, roll, assets, redraw } = this.ports;
    return {
      statblock, editable: statblock.editable, resources: this.character?.resources ?? [], assets,
      drafts: this.drafts, used: new Set(), texts: this.texts, ui: this.ui, write, askRest, roll, redraw,
    };
  }

  /** The character's name and the header's plates: hit points (as a track where the GM draws one), armour, level, type. */
  private header(context: StatblockContext): HTMLElement {
    const { statblock } = context;
    const header = node('header', 'sb-header');
    header.append(node('h3', 'book-name', statblock.displayName ?? this.character?.name ?? ''));
    const plates = node('div', 'sb-sigils');
    for (const name of SIGILS) {
      if (name === 'hp' && statblock.hitPoints !== undefined) {
        plates.append(nodeElement(context, statblock.hitPoints, 'sigil.hp'));
        continue;
      }
      const sigil: SheetValue | undefined = statblock.sigils[name];
      if (sigil !== undefined) plates.append(valueElement(context, sigil, `sigil.${name}`));
    }
    if (plates.childElementCount > 0) header.append(plates);
    return header;
  }

  private compendiumBar(): HTMLElement {
    this.barRoot ??= createRoot(this.barHost);
    this.barRoot.render(createElement(SheetCompendiumBar, { compendium: this.ports.compendium }));
    return this.barHost;
  }
}
