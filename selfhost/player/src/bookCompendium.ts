import { pageEditParts, type CompendiumMessage, type PageEdit, type SharedPage, type SharedPageContent } from '../../../src/app/online/protocol/compendium.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { bound, button, node, randomId } from './bookDom.ts';
import { markdownBlocks } from './markdownText.ts';
import { TEXT } from './text.ts';

export interface CompendiumPorts {
  send(message: PlayerMessage): void;
  tell(text: string): void;
  /** The book redraws its page. */
  redraw(): void;
  /** The list of pages came or went: the book's button may show or hide. */
  changed(): void;
}

/** The kinds in the order the list shows them. */
const KINDS = ['spell', 'monster', 'class', 'subclass', 'species', 'background', 'feat', 'item', 'magic-item', 'condition', 'rule', 'other'];

/**
 * The compendium pages the GM shared with this player: a list by kind, a page read as a card
 * (its lines, its named entries, its text), and a form to change it where the GM lets them.
 * What is typed in the form survives a redraw; a change goes in parts and the GM says how it went.
 */
export class CompendiumPages {
  private pages: readonly SharedPage[] = [];
  private readonly contents = new Map<string, SharedPageContent>();
  private shown: string | null = null;
  private editing: string | null = null;
  private saving: string | null = null;
  private readonly drafts = new Map<string, string>();

  constructor(private readonly ports: CompendiumPorts) {}

  get hasPages(): boolean {
    return this.pages.length > 0;
  }

  receive(message: CompendiumMessage): void {
    if (message.t === 'compendium') {
      const had = this.hasPages;
      this.pages = message.pages;
      const kept = new Set(message.pages.map((page) => page.id));
      for (const id of [...this.contents.keys()]) if (!kept.has(id)) this.contents.delete(id);
      if (this.shown !== null && !kept.has(this.shown)) this.close();
      if (this.editing !== null && this.pages.find((page) => page.id === this.editing)?.access !== 'write') this.stopEditing();
      if (had !== this.hasPages) this.ports.changed();
    } else if (message.t === 'compendium-entry') {
      this.contents.set(message.page.id, message.page);
      if (this.editing === message.page.id && message.page.access !== 'write') this.stopEditing();
    } else {
      if (this.saving === message.id) this.saving = null;
      if (message.ok) {
        this.ports.tell(TEXT.compendium.saved);
        if (this.editing === message.id) this.stopEditing();
      } else {
        this.ports.tell(TEXT.compendium.refused);
      }
    }
    this.ports.redraw();
  }

  page(): HTMLElement {
    const page = node('div', 'book-page cpd');
    if (this.shown === null) {
      page.append(this.list());
      return page;
    }
    const id = this.shown;
    page.append(button(TEXT.compendium.back, () => {
      this.close();
      this.ports.redraw();
    }, 'book-button cpd-back'));
    const content = this.contents.get(id);
    if (content === undefined) {
      page.append(node('p', 'book-empty', TEXT.compendium.loading));
      return page;
    }
    page.append(this.editing === id && content.fields !== undefined ? this.form(content) : this.card(content));
    return page;
  }

  private list(): HTMLElement {
    const list = node('div', 'cpd-list');
    if (this.pages.length === 0) {
      list.append(node('p', 'book-empty', TEXT.compendium.none));
      return list;
    }
    const kinds = [...KINDS, ...new Set(this.pages.map((page) => page.kind).filter((kind) => !KINDS.includes(kind)))];
    for (const kind of kinds) {
      const pages = this.pages.filter((page) => page.kind === kind || (kind === 'other' && !KINDS.includes(page.kind)));
      if (pages.length === 0) continue;
      list.append(node('h4', 'cpd-kind-heading', TEXT.compendium.kinds[kind] ?? TEXT.compendium.kinds.other));
      for (const shared of pages) {
        const choice = button(shared.title, () => this.open(shared.id), 'book-button cpd-entry');
        if (shared.access === 'write') choice.append(node('span', 'cpd-badge', TEXT.compendium.writable));
        list.append(choice);
      }
    }
    return list;
  }

  private open(id: string): void {
    this.shown = id;
    this.ports.send({ t: 'compendium-open', id });
    this.ports.redraw();
  }

  private close(): void {
    this.shown = null;
    this.stopEditing();
  }

  private stopEditing(): void {
    if (this.editing !== null) for (const key of [...this.drafts.keys()]) if (key.startsWith(`${this.editing}.`)) this.drafts.delete(key);
    this.editing = null;
  }

  private card(content: SharedPageContent): HTMLElement {
    const card = node('article', 'cpd-card');
    card.append(node('h3', 'cpd-title', content.title));
    card.append(node('p', 'cpd-subtitle', `${TEXT.compendium.kind[content.kind] ?? TEXT.compendium.kind.other} · ${content.access === 'write' ? TEXT.compendium.writable : TEXT.compendium.readOnly}`));
    if (content.rows.length > 0) {
      card.append(node('hr', 'cpd-rule'));
      const rows = node('dl', 'cpd-rows');
      for (const row of content.rows) {
        const line = node('div', 'cpd-row');
        line.append(node('dt', 'cpd-label', row.label), node('dd', 'cpd-value', row.value));
        rows.append(line);
      }
      card.append(rows);
    }
    for (const section of content.sections) {
      card.append(node('h4', 'cpd-section', section.heading));
      for (const entry of section.entries) {
        const paragraph = node('p', 'cpd-entry-text');
        if (entry.name !== '') paragraph.append(node('strong', 'cpd-entry-name', `${entry.name}. `));
        paragraph.append(document.createTextNode(entry.text));
        card.append(paragraph);
      }
    }
    if (content.text !== '') {
      card.append(node('hr', 'cpd-rule'));
      const text = node('div', 'cpd-text');
      text.append(...markdownBlocks(content.text));
      card.append(text);
    }
    if (content.access === 'write' && content.fields !== undefined) {
      card.append(button(TEXT.compendium.edit, () => {
        this.editing = content.id;
        this.ports.redraw();
      }, 'book-button book-primary cpd-edit'));
    }
    return card;
  }

  private form(content: SharedPageContent): HTMLElement {
    const form = node('form', 'book-form cpd-form');
    form.append(node('h3', 'cpd-title', content.title));
    const inputs = (content.fields ?? []).map((field) => {
      const label = node('label', 'cpd-field');
      const input = bound(this.drafts, `${content.id}.field.${field.key}`, node('input', 'book-input'), field.value);
      label.append(node('span', 'cpd-label', field.label), input);
      form.append(label);
      return { key: field.key, input };
    });
    const textLabel = node('label', 'cpd-field');
    const text = bound(this.drafts, `${content.id}.text`, node('textarea', 'book-input book-area cpd-area'), content.text);
    textLabel.append(node('span', 'cpd-label', TEXT.compendium.text), text);
    form.append(textLabel);
    const save = node('button', 'book-button book-primary', this.saving === content.id ? TEXT.compendium.sending : TEXT.compendium.save);
    save.type = 'submit';
    save.disabled = this.saving === content.id;
    form.append(save, button(TEXT.compendium.cancel, () => {
      this.stopEditing();
      this.ports.redraw();
    }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.saving !== null) return;
      const change: PageEdit = { fields: Object.fromEntries(inputs.map(({ key, input }) => [key, input.value])), text: text.value };
      const parts = pageEditParts(content.id, randomId().slice(0, 24), change);
      if (parts === null) return this.ports.tell(TEXT.book.tooLong);
      this.saving = content.id;
      for (const part of parts) this.ports.send(part);
      this.ports.redraw();
    });
    return form;
  }
}
