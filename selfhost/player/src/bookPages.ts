import { MAX_COIN_NAME, MAX_NOTE_BODY, type BookCharacter, type BookItem, type BookNote, type BookQuest, type BookWorldMap, type PurseRow } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { AssetLoader } from './assets.ts';

/** What every page needs: an element maker, the assets, and the way to the GM. */
export interface PageContext {
  readonly assets: AssetLoader;
  readonly send: (message: PlayerMessage) => void;
  /** Draws the book again (an asset arrived). */
  readonly redraw: () => void;
}

export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(label: string, act: () => void): HTMLButtonElement {
  const element = node('button', 'book-button', label);
  element.type = 'button';
  element.addEventListener('click', act);
  return element;
}

const randomId = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const imageCache = new Map<string, string>();

function picture(context: PageContext, ref: { hash: string; size: number; mime: string }, side: number, className: string): HTMLElement {
  const known = imageCache.get(ref.hash);
  if (known !== undefined) {
    const element = node('img', className);
    element.alt = '';
    element.src = known;
    return element;
  }
  context.assets.image(ref, side).then((loaded) => {
    imageCache.set(ref.hash, loaded.url);
    context.redraw();
  }).catch(() => undefined);
  return node('div', `${className} book-placeholder`);
}

export function characterPage(context: PageContext, character: BookCharacter | null): HTMLElement {
  const page = node('div', 'book-page');
  if (character === null) {
    page.append(node('p', 'book-empty', 'Le MJ ne t\'a pas encore donné de personnage.'));
    return page;
  }
  const head = node('div', 'book-character');
  if (character.art !== null) {
    const art = picture(context, character.art, 256, 'book-portrait');
    if (character.ring !== null) art.style.borderColor = character.ring;
    head.append(art);
  }
  head.append(node('h3', 'book-name', character.name));
  page.append(head);
  for (const resource of character.resources) {
    const row = node('div', 'book-resource');
    row.append(node('span', 'book-resource-name', resource.name));
    const value = node('span', 'book-resource-value', resource.direction === 'static' ? String(resource.max) : `${resource.current} / ${resource.max}`);
    const bar = node('span', 'book-resource-bar');
    const fill = node('span', 'book-resource-fill');
    fill.style.background = resource.colour;
    fill.style.width = `${resource.direction === 'static' || resource.max <= 0 ? 100 : Math.max(0, Math.min(100, (resource.current / resource.max) * 100))}%`;
    bar.append(fill);
    row.append(bar, value);
    if (resource.editable && resource.key !== null && resource.direction !== 'static') {
      const key = resource.key;
      const step = (delta: number): void => context.send({ t: 'book-resource', key, current: Math.max(0, Math.min(resource.max, resource.current + delta)) });
      row.append(button('−', () => step(-1)), button('+', () => step(1)));
    }
    page.append(row);
  }
  return page;
}

export function itemsPage(items: readonly BookItem[]): HTMLElement {
  const page = node('div', 'book-page');
  if (items.length === 0) page.append(node('p', 'book-empty', 'Aucun objet pour l\'instant.'));
  for (const item of items) {
    const card = node('article', 'book-item');
    if (item.tone !== null) card.dataset.tone = item.tone;
    card.append(node('h3', 'book-item-name', item.name));
    const meta = [item.type, item.rarity, item.price].filter((part): part is string => part !== null && part !== '').join(' · ');
    if (meta !== '') card.append(node('p', 'book-item-meta', meta));
    if (item.description !== null) card.append(node('p', 'book-text', item.description));
    for (const property of item.properties) card.append(node('p', 'book-item-property', `${property.label} : ${property.value}`));
    page.append(card);
  }
  return page;
}

export function notesPage(context: PageContext, notes: readonly BookNote[]): HTMLElement {
  const page = node('div', 'book-page');
  const form = node('form', 'book-form');
  const title = node('input', 'book-input');
  title.placeholder = 'Titre';
  title.maxLength = MAX_BOOK_TITLE;
  const body = node('textarea', 'book-input book-area');
  body.placeholder = 'Ta note…';
  body.maxLength = MAX_NOTE_BODY;
  let editing: string | null = null;
  const save = button('Ajouter la note', () => undefined);
  save.type = 'submit';
  form.append(title, body, save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (title.value.trim() === '' && body.value.trim() === '') return;
    context.send({ t: 'book-note', note: { id: editing ?? randomId(), title: title.value.trim(), body: body.value } });
    title.value = '';
    body.value = '';
    editing = null;
    save.textContent = 'Ajouter la note';
  });
  page.append(form);
  for (const note of notes.filter((entry) => entry.quest === undefined)) {
    const card = node('article', 'book-note');
    card.append(node('h3', 'book-item-name', note.title === '' ? 'Sans titre' : note.title), node('p', 'book-text', note.body));
    card.append(button('Modifier', () => {
      editing = note.id;
      title.value = note.title;
      body.value = note.body;
      save.textContent = 'Enregistrer';
      title.focus();
    }), button('Supprimer', () => context.send({ t: 'book-note-delete', id: note.id })));
    page.append(card);
  }
  return page;
}

const STATE_NAMES: Readonly<Record<BookQuest['state'], string>> = { open: 'Ouverte', active: 'En cours', done: 'Accomplie', failed: 'Échouée' };

export function questsPage(context: PageContext, quests: readonly BookQuest[], texts: Map<string, string>): HTMLElement {
  const page = node('div', 'book-page');
  if (quests.length === 0) page.append(node('p', 'book-empty', 'Aucune quête pour l\'instant.'));
  for (const quest of quests) {
    const card = node('article', 'book-quest');
    card.dataset.state = quest.state;
    card.append(node('h3', 'book-item-name', quest.title), node('p', 'book-item-meta', `${quest.kind === 'main' ? 'Principale' : 'Secondaire'} · ${STATE_NAMES[quest.state]}${quest.xp > 0 ? ` · ${quest.xp} XP` : ''}`));
    if (quest.body !== '') card.append(node('p', 'book-text', quest.body));
    if (quest.text !== undefined) {
      const known = texts.get(quest.text.hash);
      if (known !== undefined) card.append(node('p', 'book-text', known));
      else context.assets.text(quest.text).then((text) => {
        texts.set(quest.text?.hash ?? '', text);
        context.redraw();
      }).catch(() => undefined);
    }
    page.append(card);
  }
  return page;
}

export function pursePage(context: PageContext, purse: readonly PurseRow[]): HTMLElement {
  const page = node('div', 'book-page');
  const form = node('form', 'book-form');
  const rows = purse.length === 0 ? [{ name: 'Or', amount: 0 }] : purse;
  const inputs = rows.map((row) => {
    const line = node('label', 'book-purse-row');
    const name = node('input', 'book-input');
    name.value = row.name;
    name.maxLength = MAX_COIN_NAME;
    const amount = node('input', 'book-input book-amount');
    amount.type = 'number';
    amount.min = '0';
    amount.step = '1';
    amount.value = String(row.amount);
    line.append(name, amount);
    form.append(line);
    return { name, amount };
  });
  const save = button('Enregistrer la bourse', () => undefined);
  save.type = 'submit';
  form.append(save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = inputs.map(({ name, amount }) => ({ name: name.value.trim(), amount: Math.max(0, Math.floor(Number(amount.value) || 0)) })).filter((row) => row.name !== '');
    context.send({ t: 'book-purse', purse: next });
  });
  page.append(form);
  return page;
}

export function mapPage(context: PageContext, map: BookWorldMap | null): HTMLElement {
  const page = node('div', 'book-page');
  if (map === null) {
    page.append(node('p', 'book-empty', 'Le MJ n\'a pas partagé de carte du monde.'));
    return page;
  }
  page.append(picture(context, map.image, 4096, 'book-map'));
  return page;
}
