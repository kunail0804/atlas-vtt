import { parsePlayerBookMessage, type BookMessage, type PlayerBook, type PlayerBookMessage } from '../../../src/app/online/protocol/book.ts';
import { fitsPlayerFrame } from '../../../src/app/online/protocol/bookText.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { applyBookMessage, shelfMessageOf } from '../../../src/app/online/gm/book/bookStore.ts';
import type { AssetLoader } from './assets.ts';
import type { BookUi, PageContext, Tab } from './bookContext.ts';
import { button, closeButton, node } from './bookDom.ts';
import './book.scss';
import { equipmentPage } from './bookEquipment.ts';
import { notesPage } from './bookNotes.ts';
import { itemsPage } from './bookItems.ts';
import { characterPage, pursePage } from './bookPages.ts';
import { questsPage } from './bookQuests.ts';
import { worldMapPage } from './bookWorldMap.ts';
import { TEXT } from './text.ts';
import { StatblockSheet } from './statblockPage.ts';
import type { CharacterNotesMessage } from '../../../src/app/online/protocol/characterNotes.ts';
import type { FoundNote } from '../../../src/app/online/protocol/logShown.ts';
import type { CompendiumMessage } from '../../../src/app/online/protocol/compendium.ts';
import { CompendiumPages } from './bookCompendium.ts';
import { PlayerSheetCompendium } from './sheetCompendium.ts';

const TABS: readonly Tab[] = ['character', 'sheet', 'compendium', 'items', 'equipment', 'notes', 'quests', 'purse', 'map'];
const PAGES: Readonly<Record<Exclude<Tab, 'sheet' | 'compendium'>, (context: PageContext) => HTMLElement>> = {
  character: characterPage, items: itemsPage, equipment: equipmentPage, notes: notesPage, quests: questsPage, purse: pursePage, map: worldMapPage,
};

/** What the book's statblock page takes from the table: rolls, and the reader for the character's notes. */
export interface SheetPorts {
  readonly roll: (formula: string, label: string) => void;
  readonly openNote: (note: FoundNote) => void;
}

/**
 * The player's own pages besides the table, as the GM keeps them. The GM takes a write without an
 * answer and answers a refused one with the whole book, so the page writes into its own copy by the
 * GM's own rule (`applyBookMessage`, on the message as the GM's parser cleans it) and sends it on.
 * Every text is shown as text.
 */
export class BookPanel {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly assets: AssetLoader;
  private readonly send: (message: PlayerMessage) => void;
  private readonly tell: (text: string) => void;
  private readonly drafts = new Map<string, string>();
  private readonly ui: BookUi = { tab: 'character', mapId: null, placing: false, pinDraft: null, selected: null, editing: new Map(), extraCoins: 0 };
  private book: PlayerBook | null = null;

  /** Told whether the player has a book, for the toolbar's button. */
  private readonly available: (has: boolean) => void;

  /** The character's statblock and the notes the GM linked to it. */
  private readonly sheet: StatblockSheet;

  /** The compendium pages the GM shared with this player, whether or not they play a character. */
  private readonly compendium: CompendiumPages;
  private readonly sheetCompendium: PlayerSheetCompendium;

  constructor(host: HTMLElement, assets: AssetLoader, send: (message: PlayerMessage) => void, tell: (text: string) => void, available: (has: boolean) => void, sheet: SheetPorts) {
    // The sheet reaches the compendium through the GM; a page it asks to read opens in the compendium tab.
    this.sheetCompendium = new PlayerSheetCompendium(send, () => this.compendium.expectView());
    this.sheet = new StatblockSheet({
      ...sheet, assets, tell, compendium: this.sheetCompendium,
      write: (message) => this.write(message),
      askRest: (message) => send(message),
      redraw: () => { if (!this.panel.hidden && this.ui.tab === 'sheet') this.render(); },
    });
    this.assets = assets;
    this.send = send;
    this.tell = tell;
    this.available = available;
    this.compendium = new CompendiumPages({
      send, tell,
      redraw: () => { if (!this.panel.hidden && this.ui.tab === 'compendium') this.render(); },
      changed: () => this.tellAvailable(),
      // The notes the GM links to the character are read in the compendium too: it took the Documents tab's place.
      documents: () => this.sheet.documents(),
      reveal: () => this.showTab('compendium'),
      back: () => this.showTab('sheet'),
    });
    this.panel = node('aside', 'atlas-vtt-plugin book');
    // A press in the book leaves the log open beside it.
    this.panel.dataset.keepsLogOpen = '';
    this.panel.setAttribute('aria-label', TEXT.book.open);
    this.panel.hidden = true;
    const header = node('div', 'book-header');
    header.append(node('span', 'book-title', TEXT.book.open), closeButton(TEXT.book.close, () => this.setOpen(false)));
    const tabs = node('div', 'book-tabs');
    for (const tab of TABS) {
      const choice = button(TEXT.book.tabs[tab], () => {
        this.ui.tab = tab;
        this.render();
      }, 'book-tab');
      choice.dataset.tab = tab;
      tabs.append(choice);
    }
    this.body = node('div', 'book-body');
    this.panel.append(header, tabs, this.body);
    host.append(this.panel);
  }

  receive(message: BookMessage): void {
    if (message.t === 'book') this.book = message.book;
    else if (this.book !== null && message.t === 'book-sheet') this.book = { ...this.book, character: message.character };
    else if (this.book !== null && message.t === 'book-item') {
      this.book = { ...this.book, items: [...this.book.items.filter((item) => item.id !== message.item.id), message.item] };
      this.tell(TEXT.book.newItem(message.item.name));
    } else if (message.t === 'book-statblock') this.sheet.receive(message.statblock);
    else if (message.t === 'book-rest-answer') this.sheet.receiveRestAnswer(message);
    this.tellAvailable();
    if (!this.panel.hidden) this.render();
  }

  /** The compendium pages the GM shared, as the GM sent them. */
  receiveCompendium(message: CompendiumMessage): void {
    if (message.t === 'sheet-choices') this.sheetCompendium.receive(message.kind, message.choices);
    this.compendium.receive(message);
  }

  /** Shows a tab of the book, opening the book. */
  private showTab(tab: Tab): void {
    this.ui.tab = tab;
    this.panel.hidden = false;
    this.render();
  }

  /** The book's button shows once there is a book or a shared page to open. */
  private tellAvailable(): void {
    this.available(this.book !== null || this.compendium.hasPages || this.sheet.documents().length > 0);
  }

  /** The notes the GM linked to the character, as the GM sent them. */
  receiveNotes(message: CharacterNotesMessage): void {
    this.sheet.receiveNotes(message.notes);
    this.tellAvailable();
    if (!this.panel.hidden && this.ui.tab === 'compendium') this.render();
  }

  private write(message: PlayerBookMessage): boolean {
    const book = this.book;
    // What the GM reads is the message as it crossed the wire, so the page cleans that, not the object it made.
    const parsed = parsePlayerBookMessage(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
    if (book === null) return false;
    if (parsed === null) {
      this.tell(TEXT.book.invalid);
      return false;
    }
    if (!fitsPlayerFrame(message)) {
      this.tell(TEXT.book.tooLong);
      return false;
    }
    if (parsed.t === 'book-resource') {
      const character = book.character;
      if (character !== null) this.book = { ...book, character: { ...character, resources: character.resources.map((resource) => (resource.key === parsed.key ? { ...resource, current: parsed.current } : resource)) } };
    }
    // The statblock's own messages (fields, abilities, lists, refills) change nothing here: the GM answers with the next statblock.
    const shelf = shelfMessageOf(parsed);
    if (shelf !== null) {
      const { items, notes, pins, purse, slots, equipped } = book;
      const written = applyBookMessage({ items, notes, pins, purse, slots, equipped }, shelf, Date.now(), new Set(book.quests.map((quest) => quest.id)));
      if (written === null) {
        this.tell(TEXT.book.full);
        return false;
      }
      this.book = { ...book, ...written };
    }
    this.send(message);
    this.render();
    return true;
  }

  toggle(): void {
    this.setOpen(this.panel.hidden);
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    if (open) this.render();
  }

  private render(): void {
    for (const choice of this.panel.querySelectorAll<HTMLElement>('.book-tab')) choice.setAttribute('aria-pressed', String(choice.dataset.tab === this.ui.tab));
    this.panel.classList.toggle('book-wide', this.ui.tab === 'map' || this.ui.tab === 'sheet');
    if (this.ui.tab === 'sheet') {
      // The statblock shows the book's resources, which a step of the player's changes before the GM answers.
      this.sheet.setCharacter(this.book?.character ?? null);
      return this.renderKeepingFocus(() => this.sheet.page());
    }
    if (this.ui.tab === 'compendium') return this.renderKeepingFocus(() => this.compendium.page());
    const book = this.book;
    if (book === null) return this.body.replaceChildren(node('p', 'book-empty', TEXT.book.coming));
    const context: PageContext = { book, assets: this.assets, write: (message) => this.write(message), redraw: () => this.render(), drafts: this.drafts, ui: this.ui };
    const tab = this.ui.tab;
    this.renderKeepingFocus(() => PAGES[tab](context));
  }

  /** Draws a page again: the field the player is typing in keeps the focus and the caret, the page its scroll. */
  private renderKeepingFocus(build: () => HTMLElement): void {
    const active = document.activeElement;
    const field = active instanceof HTMLElement && this.body.contains(active) ? active.dataset.field : undefined;
    const caret: readonly [number | null, number | null] | null = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(build());
    this.body.scrollTop = scroll;
    if (field === undefined) return;
    const again = this.body.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
    again?.focus();
    if (caret !== null && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement) && again.type !== 'number') again.setSelectionRange(caret[0], caret[1]);
  }
}
