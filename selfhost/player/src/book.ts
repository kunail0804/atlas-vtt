import { parsePlayerBookMessage, type BookMessage, type PlayerBook, type PlayerBookMessage } from '../../../src/app/online/protocol/book.ts';
import { fitsPlayerFrame } from '../../../src/app/online/protocol/bookText.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { applyBookMessage } from '../../../src/app/online/gm/book/bookStore.ts';
import type { AssetLoader } from './assets.ts';
import type { BookUi, PageContext, Tab } from './bookContext.ts';
import { button, node } from './bookDom.ts';
import { equipmentPage } from './bookEquipment.ts';
import { notesPage } from './bookNotes.ts';
import { characterPage, itemsPage, pursePage } from './bookPages.ts';
import { questsPage } from './bookQuests.ts';
import { worldMapPage } from './bookWorldMap.ts';
import { TEXT } from './text.ts';

const TABS: readonly Tab[] = ['character', 'items', 'equipment', 'notes', 'quests', 'purse', 'map'];
const PAGES: Readonly<Record<Tab, (context: PageContext) => HTMLElement>> = {
  character: characterPage, items: itemsPage, equipment: equipmentPage, notes: notesPage, quests: questsPage, purse: pursePage, map: worldMapPage,
};

/**
 * The player's own pages besides the table, as the GM keeps them. The GM takes a write without an
 * answer and answers a refused one with the whole book, so the page writes into its own copy by the
 * GM's own rule (`applyBookMessage`, on the message as the GM's parser cleans it) and sends it on.
 * Every text is shown as text.
 */
export class BookPanel {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly assets: AssetLoader;
  private readonly send: (message: PlayerMessage) => void;
  private readonly tell: (text: string) => void;
  private readonly drafts = new Map<string, string>();
  private readonly ui: BookUi = { tab: 'character', mapId: null, placing: false, pinDraft: null, selected: null, editing: new Map(), extraCoins: 0 };
  private book: PlayerBook | null = null;

  constructor(host: HTMLElement, assets: AssetLoader, send: (message: PlayerMessage) => void, tell: (text: string) => void) {
    this.assets = assets;
    this.send = send;
    this.tell = tell;
    this.toggleButton = button(TEXT.book.open, () => this.setOpen(this.panel.hidden), 'book-toggle');
    this.toggleButton.hidden = true;
    this.panel = node('aside', 'book');
    this.panel.setAttribute('aria-label', TEXT.book.open);
    this.panel.hidden = true;
    const header = node('div', 'book-tabs');
    for (const tab of TABS) {
      const choice = button(TEXT.book.tabs[tab], () => {
        this.ui.tab = tab;
        this.render();
      }, 'book-tab');
      choice.dataset.tab = tab;
      header.append(choice);
    }
    header.append(button(TEXT.book.close, () => this.setOpen(false), 'book-close'));
    this.body = node('div', 'book-body');
    this.panel.append(header, this.body);
    host.append(this.toggleButton, this.panel);
  }

  receive(message: BookMessage): void {
    if (message.t === 'book') this.book = message.book;
    else if (this.book !== null && message.t === 'book-sheet') this.book = { ...this.book, character: message.character };
    else if (this.book !== null && message.t === 'book-item') {
      this.book = { ...this.book, items: [...this.book.items.filter((item) => item.id !== message.item.id), message.item] };
      this.tell(TEXT.book.newItem(message.item.name));
    }
    this.toggleButton.hidden = this.book === null;
    if (!this.panel.hidden) this.render();
  }

  private write(message: PlayerBookMessage): void {
    const book = this.book;
    // What the GM reads is the message as it crossed the wire, so the page cleans that, not the object it made.
    const parsed = parsePlayerBookMessage(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
    if (book === null || parsed === null) return;
    if (!fitsPlayerFrame(message)) return this.tell(TEXT.book.tooLong);
    if (parsed.t === 'book-resource') {
      const character = book.character;
      if (character !== null) this.book = { ...book, character: { ...character, resources: character.resources.map((resource) => (resource.key === parsed.key ? { ...resource, current: parsed.current } : resource)) } };
    } else {
      const { items, notes, pins, purse, slots, equipped } = book;
      const written = applyBookMessage({ items, notes, pins, purse, slots, equipped }, parsed, Date.now(), new Set(book.quests.map((quest) => quest.id)));
      if (written === null) return this.tell(TEXT.book.full);
      this.book = { ...book, ...written };
    }
    this.send(message);
    this.render();
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    if (open) this.render();
  }

  private render(): void {
    for (const choice of this.panel.querySelectorAll<HTMLElement>('.book-tab')) choice.setAttribute('aria-pressed', String(choice.dataset.tab === this.ui.tab));
    this.panel.classList.toggle('book-wide', this.ui.tab === 'map');
    const book = this.book;
    if (book === null) return this.body.replaceChildren(node('p', 'book-empty', TEXT.book.coming));
    // The field the player is typing in keeps the focus and the caret through the redraw.
    const active = document.activeElement;
    const field = active instanceof HTMLElement && this.body.contains(active) ? active.dataset.field : undefined;
    const caret: readonly [number | null, number | null] | null = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = this.body.scrollTop;
    const context: PageContext = { book, assets: this.assets, write: (message) => this.write(message), redraw: () => this.render(), drafts: this.drafts, ui: this.ui };
    this.body.replaceChildren(PAGES[this.ui.tab](context));
    this.body.scrollTop = scroll;
    if (field === undefined) return;
    const again = this.body.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`);
    again?.focus();
    if (caret !== null && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement) && again.type !== 'number') again.setSelectionRange(caret[0], caret[1]);
  }
}
