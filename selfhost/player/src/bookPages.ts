import { MAX_COIN_NAME, MAX_PURSE_ROWS } from '../../../src/app/online/protocol/book.ts';
import { shownSlots } from '../../../src/app/online/protocol/bookSlots.ts';
import type { PageContext } from './bookContext.ts';
import { assetImage, bound, button, node } from './bookDom.ts';
import { slotName } from './bookEquipment.ts';
import { TEXT } from './text.ts';

export function characterPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const character = context.book.character;
  if (character === null) {
    page.append(node('p', 'book-empty', TEXT.book.noCharacter));
    return page;
  }
  const head = node('div', 'book-character');
  if (character.art !== null) {
    const art = assetImage(context.assets, character.art, 256, 'book-portrait');
    if (character.ring !== null) art.style.borderColor = character.ring;
    head.append(art);
  }
  head.append(node('h3', 'book-name', character.name));
  page.append(head);
  for (const resource of character.resources) {
    const row = node('div', 'book-resource');
    const fixed = resource.direction === 'static';
    const bar = node('span', 'book-resource-bar');
    const fill = node('span', 'book-resource-fill');
    fill.style.background = resource.colour;
    fill.style.width = `${fixed || resource.max <= 0 ? 100 : Math.max(0, Math.min(100, (resource.current / resource.max) * 100))}%`;
    bar.append(fill);
    row.append(node('span', 'book-resource-name', resource.name), bar, node('span', 'book-resource-value', fixed ? String(resource.max) : `${resource.current} / ${resource.max}`));
    if (resource.editable && resource.key !== null && !fixed) {
      const key = resource.key;
      const step = (delta: number): void => context.write({ t: 'book-resource', key, current: Math.max(0, Math.min(resource.max, resource.current + delta)) });
      row.append(button('−', () => step(-1)), button('+', () => step(1)));
    }
    page.append(row);
  }
  return page;
}

export function itemsPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const { items, equipped, slots } = context.book;
  if (items.length === 0) page.append(node('p', 'book-empty', TEXT.book.noItems));
  const shown = shownSlots(slots);
  for (const item of [...items].reverse()) {
    const card = node('article', 'book-item');
    if (item.tone !== null) card.dataset.tone = item.tone;
    card.append(node('h3', 'book-item-name', item.name));
    const meta = [item.type, item.rarity, item.price].filter((part): part is string => part !== null && part !== '').join(' · ');
    if (meta !== '') card.append(node('p', 'book-item-meta', meta));
    const slot = shown.find((candidate) => equipped.some((entry) => entry.item === item.id && entry.slot === candidate.id));
    if (slot !== undefined) card.append(node('p', 'book-item-slot', TEXT.book.equippedIn(slotName(slot))));
    if (item.description !== null) card.append(node('p', 'book-text', item.description));
    for (const property of item.properties) card.append(node('p', 'book-item-property', `${property.label} : ${property.value}`));
    page.append(card);
  }
  return page;
}

export function pursePage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const form = node('form', 'book-form');
  const held = context.book.purse.length === 0 ? [{ name: TEXT.purse.defaultCoin, amount: 0 }] : context.book.purse;
  const count = Math.min(MAX_PURSE_ROWS, held.length + context.ui.extraCoins);
  const inputs = Array.from({ length: count }, (_, index) => {
    const row = held[index] ?? { name: '', amount: 0 };
    const line = node('div', 'book-purse-row');
    const name = bound(context.drafts, `purse.name.${index}`, node('input', 'book-input'), row.name);
    name.maxLength = MAX_COIN_NAME;
    name.placeholder = TEXT.purse.coin;
    const amount = bound(context.drafts, `purse.amount.${index}`, node('input', 'book-input book-amount'), String(row.amount));
    amount.type = 'number';
    amount.min = '0';
    amount.step = '1';
    amount.inputMode = 'numeric';
    line.append(name, amount);
    form.append(line);
    return { name, amount };
  });
  if (count < MAX_PURSE_ROWS) form.append(button(TEXT.purse.addRow, () => {
    context.ui.extraCoins += 1;
    context.redraw();
  }));
  const save = node('button', 'book-button book-primary', TEXT.purse.save);
  save.type = 'submit';
  form.append(save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const purse = inputs.map(({ name, amount }) => ({ name: name.value.trim(), amount: Math.max(0, Math.min(1e9, Math.floor(Number(amount.value) || 0))) })).filter((row) => row.name !== '');
    for (const key of [...context.drafts.keys()].filter((draft) => draft.startsWith('purse.'))) context.drafts.delete(key);
    context.ui.extraCoins = 0;
    context.write({ t: 'book-purse', purse });
  });
  page.append(form);
  return page;
}
