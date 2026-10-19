import { MAX_ITEM_PROPERTIES, MAX_ITEM_TEXT, type BookItem } from '../../../src/app/online/protocol/book.ts';
import { shownSlots } from '../../../src/app/online/protocol/bookSlots.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import type { PageContext } from './bookContext.ts';
import { bound, button, node, randomId } from './bookDom.ts';
import { slotName } from './bookEquipment.ts';
import { TEXT } from './text.ts';

/** The key of the item being written in `BookUi.editing`: its id, a new one for an item still to add. */
const SCOPE = 'item';
const FIELDS = ['name', 'type', 'rarity', 'price', 'description', 'properties'] as const;
type Field = (typeof FIELDS)[number];
const draftKey = (field: Field): string => `item.${field}`;

/** An item's properties as the form shows them: one `label : value` a line. */
const propertyLines = (item: BookItem): string => item.properties.map((property) => `${property.label} : ${property.value}`).join('\n');

/** The properties typed in the form: each line with a label and a value, split at its first colon. */
function propertiesOf(text: string): { label: string; value: string }[] {
  const properties: { label: string; value: string }[] = [];
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    const label = colon < 0 ? '' : line.slice(0, colon).trim();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    if (label !== '' && value !== '') properties.push({ label, value });
  }
  return properties.slice(0, MAX_ITEM_PROPERTIES);
}

/** The form that writes one item, new or held; what is typed survives a redraw. */
function itemForm(context: PageContext, id: string): HTMLFormElement {
  const form = node('form', 'book-form book-item-form');
  const reset = (): void => {
    for (const field of FIELDS) context.drafts.delete(draftKey(field));
    context.ui.editing.delete(SCOPE);
  };
  const line = (field: Field, placeholder: string): HTMLInputElement => {
    const input = bound(context.drafts, draftKey(field), node('input', 'book-input'), '');
    input.placeholder = placeholder;
    input.maxLength = MAX_BOOK_TITLE;
    input.setAttribute('aria-label', placeholder);
    return input;
  };
  const name = line('name', TEXT.items.name);
  name.required = true;
  const type = line('type', TEXT.items.type);
  const rarity = line('rarity', TEXT.items.rarity);
  const price = line('price', TEXT.items.price);
  const description = bound(context.drafts, draftKey('description'), node('textarea', 'book-input book-area'), '');
  description.placeholder = TEXT.items.description;
  description.maxLength = MAX_ITEM_TEXT;
  description.setAttribute('aria-label', TEXT.items.description);
  const properties = bound(context.drafts, draftKey('properties'), node('textarea', 'book-input book-area'), '');
  properties.placeholder = TEXT.items.properties;
  properties.setAttribute('aria-label', TEXT.items.properties);
  properties.maxLength = MAX_ITEM_TEXT;
  const save = node('button', 'book-button book-primary', TEXT.items.save);
  save.type = 'submit';
  form.append(name, type, rarity, price, description, properties, save, button(TEXT.items.cancel, () => {
    reset();
    context.redraw();
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (name.value.trim() === '') return;
    const optional = (input: HTMLInputElement | HTMLTextAreaElement): string | null => (input.value.trim() === '' ? null : input.value);
    const taken = context.write({ t: 'book-item-put', item: {
      id, name: name.value, type: optional(type), rarity: optional(rarity), price: optional(price), description: optional(description), properties: propertiesOf(properties.value),
    } });
    // A refused item stays in the form, as typed, for the player to fix.
    if (!taken) return;
    reset();
    context.redraw();
  });
  return form;
}

/** Starts writing `item` in the form, or a new item without one. */
function edit(context: PageContext, item: BookItem | null): void {
  context.ui.editing.set(SCOPE, item?.id ?? randomId());
  const values: Record<Field, string> = item === null
    ? { name: '', type: '', rarity: '', price: '', description: '', properties: '' }
    : { name: item.name, type: item.type ?? '', rarity: item.rarity ?? '', price: item.price ?? '', description: item.description ?? '', properties: propertyLines(item) };
  for (const field of FIELDS) context.drafts.set(draftKey(field), values[field]);
  context.redraw();
}

/**
 * What the character carries: every item of the book, the newest first, each one the player may change
 * or take away (those the GM handed over too), and a form to add one. The GM sees and keeps the same list.
 */
export function itemsPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const { items, equipped, slots } = context.book;
  const editing = context.ui.editing.get(SCOPE);
  if (editing !== undefined && !items.some((item) => item.id === editing)) page.append(itemForm(context, editing));
  else if (editing === undefined) page.append(button(TEXT.items.add, () => edit(context, null), 'book-button book-primary'));
  if (items.length === 0) page.append(node('p', 'book-empty', TEXT.book.noItems));
  const shown = shownSlots(slots);
  for (const item of [...items].reverse()) {
    if (item.id === editing) {
      page.append(itemForm(context, item.id));
      continue;
    }
    const card = node('article', 'book-item');
    if (item.tone !== null) card.dataset.tone = item.tone;
    card.append(node('h3', 'book-item-name', item.name));
    const meta = [item.type, item.rarity, item.price].filter((part): part is string => part !== null && part !== '').join(' · ');
    if (meta !== '') card.append(node('p', 'book-item-meta', meta));
    const slot = shown.find((candidate) => equipped.some((entry) => entry.item === item.id && entry.slot === candidate.id));
    if (slot !== undefined) card.append(node('p', 'book-item-slot', TEXT.book.equippedIn(slotName(slot))));
    if (item.description !== null) card.append(node('p', 'book-text', item.description));
    for (const property of item.properties) card.append(node('p', 'book-item-property', `${property.label} : ${property.value}`));
    card.append(button(TEXT.items.edit, () => edit(context, item)), button(TEXT.items.remove, () => context.write({ t: 'book-item-delete', id: item.id })));
    page.append(card);
  }
  return page;
}
