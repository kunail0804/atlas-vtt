import type { BookMessage, PlayerBook } from '../../../src/app/online/protocol/book.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { AssetLoader } from './assets.ts';
import { characterPage, itemsPage, mapPage, node, notesPage, pursePage, questsPage, type PageContext } from './bookPages.ts';

type Tab = 'character' | 'items' | 'notes' | 'quests' | 'purse' | 'map';
const TABS: ReadonlyArray<[Tab, string]> = [['character', 'Personnage'], ['items', 'Objets'], ['notes', 'Notes'], ['quests', 'Quêtes'], ['purse', 'Bourse'], ['map', 'Carte']];

/**
 * The player's own pages besides the table, as the GM keeps them: their character, the items the
 * GM handed over, their notes, quests, purse and the world map. What the player writes goes to the
 * GM, who answers a refused write with the whole book; every text is shown as text.
 */
export class BookPanel {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly context: PageContext;
  private readonly texts = new Map<string, string>();
  private book: PlayerBook | null = null;
  private tab: Tab = 'character';

  constructor(host: HTMLElement, assets: AssetLoader, send: (message: PlayerMessage) => void) {
    this.context = { assets, send, redraw: () => this.render() };
    this.toggleButton = node('button', 'book-toggle', 'Mon livre');
    this.toggleButton.type = 'button';
    this.toggleButton.hidden = true;
    this.toggleButton.addEventListener('click', () => this.setOpen(this.panel.hidden));
    this.panel = node('aside', 'book');
    this.panel.setAttribute('aria-label', 'Mon livre');
    this.panel.hidden = true;
    const header = node('div', 'book-tabs');
    for (const [tab, label] of TABS) {
      const choice = node('button', 'book-tab', label);
      choice.type = 'button';
      choice.dataset.tab = tab;
      choice.addEventListener('click', () => {
        this.tab = tab;
        this.render();
      });
      header.append(choice);
    }
    const close = node('button', 'book-close', 'Fermer');
    close.type = 'button';
    close.addEventListener('click', () => this.setOpen(false));
    header.append(close);
    this.body = node('div', 'book-body');
    this.panel.append(header, this.body);
    host.append(this.toggleButton, this.panel);
  }

  receive(message: BookMessage): void {
    if (message.t === 'book') this.book = message.book;
    else if (this.book !== null && message.t === 'book-sheet') this.book = { ...this.book, character: message.character };
    else if (this.book !== null && message.t === 'book-item') this.book = { ...this.book, items: [...this.book.items.filter((item) => item.id !== message.item.id), message.item] };
    this.toggleButton.hidden = this.book === null;
    if (!this.panel.hidden) this.render();
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    if (open) this.render();
  }

  private render(): void {
    for (const choice of this.panel.querySelectorAll<HTMLElement>('.book-tab')) choice.setAttribute('aria-pressed', String(choice.dataset.tab === this.tab));
    const book = this.book;
    if (book === null) return this.body.replaceChildren(node('p', 'book-empty', 'Ton livre arrive…'));
    const pages: Record<Tab, () => HTMLElement> = {
      character: () => characterPage(this.context, book.character),
      items: () => itemsPage(book.items),
      notes: () => notesPage(this.context, book.notes),
      quests: () => questsPage(this.context, book.quests, this.texts),
      purse: () => pursePage(this.context, book.purse),
      map: () => mapPage(this.context, book.worldMap),
    };
    this.body.replaceChildren(pages[this.tab]());
  }
}
