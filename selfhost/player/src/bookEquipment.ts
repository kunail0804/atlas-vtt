import { DEFAULT_SLOTS, MAX_OWN_SLOTS, MAX_SLOT_NAME, shownSlots, type BookSlots, type DefaultSlot, type ShownSlot } from '../../../src/app/online/protocol/bookSlots.ts';
import type { PageContext } from './bookContext.ts';
import { bound, button, node, randomId } from './bookDom.ts';
import { TEXT } from './text.ts';

const isDefault = (id: string): id is DefaultSlot => (DEFAULT_SLOTS as readonly string[]).includes(id);

/** A slot's name as the page shows it: the default slots in the page's words, the player's own as they named them. */
export function slotName(slot: ShownSlot): string {
  return !slot.own && isDefault(slot.id) ? TEXT.equipment.slots[slot.id] : slot.name;
}

/** The slots and what lies in each: choosing an item puts it there (out of any other slot), the empty choice takes it out. */
function slotRows(context: PageContext): HTMLElement {
  const list = node('div', 'book-slots');
  const { items, equipped, slots } = context.book;
  for (const slot of shownSlots(slots)) {
    const row = node('label', 'book-slot');
    const held = equipped.find((entry) => entry.slot === slot.id)?.item;
    const choice = node('select', 'book-input');
    choice.dataset.slot = slot.id;
    const none = node('option', '', TEXT.equipment.empty);
    none.value = '';
    choice.append(none);
    for (const item of items) {
      const elsewhere = equipped.some((entry) => entry.item === item.id && entry.slot !== slot.id);
      if (elsewhere) continue;
      const option = node('option', '', item.name);
      option.value = item.id;
      choice.append(option);
    }
    choice.value = held ?? '';
    choice.addEventListener('change', () => {
      if (choice.value === '' && held !== undefined) context.write({ t: 'book-equip', item: held, slot: null });
      else if (choice.value !== '') context.write({ t: 'book-equip', item: choice.value, slot: slot.id });
    });
    row.append(node('span', 'book-slot-name', slotName(slot)), choice);
    list.append(row);
  }
  return list;
}

/** Which default slots show, and the player's own: hidden ones keep nothing, so their item goes back to the bag. */
function slotSettings(context: PageContext): HTMLElement {
  const section = node('details', 'book-slot-settings');
  section.append(node('summary', '', TEXT.equipment.manage));
  const slots = context.book.slots;
  const write = (next: BookSlots): void => context.write({ t: 'book-slots', slots: next });
  for (const id of DEFAULT_SLOTS) {
    const hidden = slots.hidden.includes(id);
    const row = node('div', 'book-slot-setting');
    row.append(node('span', hidden ? 'book-slot-name book-muted' : 'book-slot-name', TEXT.equipment.slots[id]), button(hidden ? TEXT.equipment.show : TEXT.equipment.hide, () => write({
      ...slots, hidden: hidden ? slots.hidden.filter((slot) => slot !== id) : [...slots.hidden, id],
    })));
    section.append(row);
  }
  for (const own of slots.own) {
    const row = node('div', 'book-slot-setting');
    row.append(node('span', 'book-slot-name', own.name), button(TEXT.equipment.remove, () => write({ ...slots, own: slots.own.filter((slot) => slot.id !== own.id) })));
    section.append(row);
  }
  if (slots.own.length < MAX_OWN_SLOTS) {
    const form = node('form', 'book-inline-form');
    const name = bound(context.drafts, 'slot.name', node('input', 'book-input'), '');
    name.maxLength = MAX_SLOT_NAME;
    name.placeholder = TEXT.equipment.slotName;
    const add = node('button', 'book-button', TEXT.equipment.addSlot);
    add.type = 'submit';
    form.append(name, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (name.value.trim() === '') return;
      context.drafts.delete('slot.name');
      write({ ...slots, own: [...slots.own, { id: randomId(), name: name.value.trim() }] });
    });
    section.append(form);
  }
  // A redraw keeps the settings open where the player opened them.
  section.open = context.drafts.get('slot.open') === 'yes';
  section.addEventListener('toggle', () => context.drafts.set('slot.open', section.open ? 'yes' : 'no'));
  return section;
}

export function equipmentPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  page.append(slotRows(context), slotSettings(context));
  return page;
}
