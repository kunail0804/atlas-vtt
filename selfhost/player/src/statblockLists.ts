import { isPairLabel, type SheetField, type SheetListItem, type SheetValue } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import { normalisePairs } from '../../../src/app/statblocks/values/pairValues.ts';
import { button, node } from './bookDom.ts';
import { drafted, type StatblockContext } from './statblockContext.ts';
import { rawText } from './statblockFields.ts';
import { TEXT } from './text.ts';

/** An entry as the page shows it with the item that names it to the GM. */
interface ListEntry {
  readonly shown: string;
  readonly item: SheetListItem;
}

/** A pair's value as the GM compares it: a number or a line as the note holds it, none for anything else. */
const pairValue = (value: unknown): string | number | null => (typeof value === 'number' || typeof value === 'string' ? value : null);

/** The entries of a Words or a Labels and values value, each named as the note holds it. */
function entriesOf(value: SheetValue, field: SheetField): ListEntry[] {
  if (field.type === 'list') return (value.words ?? []).map((word) => ({ shown: word, item: word }));
  // The GM finds a pair to take out by its label and value as stored, which the page's text of it ("+2") is not.
  return normalisePairs(field.value as Parameters<typeof normalisePairs>[0]).map((pair) => {
    const held = pairValue(pair.value);
    return { shown: held === null ? pair.key : `${pair.key} ${held}`, item: { label: pair.key, value: held } };
  });
}

/** A typed pair value: a number where it reads as one, else the line, none for an empty input. */
function typedPairValue(text: string): string | number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const number = Number(trimmed.replace(',', '.'));
  return Number.isFinite(number) ? number : trimmed;
}

/** The inputs that add an entry: a word, or a label with its value. */
function addForm(context: StatblockContext, field: SheetField, label: string): HTMLFormElement {
  const form = node('form', 'book-inline-form sb-list-add');
  const id = `${field.key}.add`;
  const first = drafted(context, `${id}.label`, field.base, node('input', 'book-input'), '');
  first.maxLength = MAX_BOOK_TITLE;
  first.placeholder = field.type === 'list' ? TEXT.sheet.word : TEXT.sheet.pairLabel;
  first.setAttribute('aria-label', `${label} : ${first.placeholder}`);
  form.append(first);
  const second = field.type === 'pairs' ? drafted(context, `${id}.value`, field.base, node('input', 'book-input'), '') : null;
  if (second !== null) {
    second.maxLength = MAX_BOOK_TITLE;
    second.placeholder = TEXT.sheet.pairValue;
    second.setAttribute('aria-label', `${label} : ${TEXT.sheet.pairValue}`);
    form.append(second);
  }
  const add = node('button', 'book-button', TEXT.sheet.add);
  add.type = 'submit';
  form.append(add);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = first.value.trim();
    if (name === '' || (second !== null && !isPairLabel(name))) return;
    const item: SheetListItem = second === null ? name : { label: name, value: typedPairValue(second.value) };
    if (context.write({ t: 'book-list', op: 'add', key: field.key, item })) {
      first.value = '';
      if (second !== null) second.value = '';
      for (const key of [...context.drafts.keys()].filter((draft) => draft.startsWith(`${id}.`))) context.drafts.delete(key);
    }
  });
  return form;
}

/** A Words or Labels and values value the player may change: its entries, each taken out with its ×, and a form to add one. */
export function listEditor(context: StatblockContext, value: SheetValue, field: SheetField): HTMLElement {
  const label = value.label ?? field.key;
  const element = node('div', 'sb-list');
  const chips = node('span', 'sb-chips');
  for (const entry of entriesOf(value, field)) {
    const chip = node('span', 'sb-chip', entry.shown);
    const remove = button('×', () => void context.write({ t: 'book-list', op: 'remove', key: field.key, item: entry.item }), 'sb-chip-remove');
    remove.setAttribute('aria-label', TEXT.sheet.remove(entry.shown));
    chip.append(remove);
    chips.append(chip);
  }
  if (chips.childElementCount === 0 && field.value !== null) chips.append(node('span', 'sb-plain', rawText(field.value)));
  element.append(chips, addForm(context, field, label));
  return element;
}
