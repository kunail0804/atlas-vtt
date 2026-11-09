import { MAX_FIELD_TEXT, type SheetField, type SheetRaw, type SheetValue } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import { node } from './bookDom.ts';
import { drafted, type StatblockContext } from './statblockContext.ts';
import { rollButton } from './statblockControls.ts';
import { TEXT } from './text.ts';

/** A stored value as an input shows it: a list as its items joined by commas. */
export function rawText(value: SheetRaw): string {
  if (value === null) return '';
  if (Array.isArray(value)) return value.map(rawText).join(', ');
  return typeof value === 'object' ? '' : String(value);
}

/** A typed number, or null for none. */
function typedNumber(text: string): number | null {
  const number = Number(text.replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(number) ? null : number;
}

/** What the player typed as the value the field stores: none for an empty input. */
function typedValue(field: SheetField, text: string): SheetRaw {
  if (text.trim() === '') return null;
  switch (field.type) {
    case 'number': return typedNumber(text);
    case 'rating': return typedNumber(text) ?? text.trim();
    case 'list': return text.split(',').map((item) => item.trim()).filter((item) => item !== '');
    default: return text;
  }
}

/** Sends the field's new value against the base the sheet showed. */
export function writeField(context: StatblockContext, field: SheetField, value: SheetRaw, cell?: readonly [number, number]): boolean {
  return context.write({ t: 'book-field', key: field.key, base: field.base, value, ...(cell !== undefined && { cell }) });
}

/** A choice of several options: a box each, sent in the options' order; open values the note holds besides them stay. */
function picks(context: StatblockContext, field: SheetField, label: string, id: string): HTMLElement {
  const options = field.options ?? [];
  const held = Array.isArray(field.value) ? field.value.map(rawText) : field.value === null ? [] : [rawText(field.value)];
  const group = node('span', 'sb-picks');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  const boxes = options.map((option, index) => {
    const line = node('label', 'sb-pick');
    const box = node('input', 'sb-check');
    box.type = 'checkbox';
    box.checked = held.includes(option);
    box.dataset.field = `${id}.${index}`;
    line.append(box, document.createTextNode(option));
    group.append(line);
    return box;
  });
  const others = held.filter((value) => !options.includes(value));
  group.addEventListener('change', () => {
    const chosen = [...options.filter((_, index) => boxes[index]?.checked === true), ...(field.open === true ? others : [])];
    writeField(context, field, chosen.length === 0 ? null : chosen);
  });
  return group;
}

/** One option of a list, or the player's own words where the choice is open. */
function choice(context: StatblockContext, field: SheetField, label: string, id: string): HTMLElement {
  const options = field.options ?? [];
  if (field.open === true) {
    const input = drafted(context, id, field.base, node('input', 'book-input sb-input'), rawText(field.value));
    const list = node('datalist', '');
    list.id = `sb-options-${id}`;
    list.append(...options.map((option) => Object.assign(node('option', ''), { value: option })));
    input.setAttribute('list', list.id);
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => writeField(context, field, typedValue(field, input.value)));
    const wrap = node('span', 'sb-editor');
    wrap.append(input, list);
    return wrap;
  }
  const select = node('select', 'book-input sb-input');
  select.append(Object.assign(node('option', '', TEXT.sheet.choose), { value: '' }), ...options.map((option) => Object.assign(node('option', '', option), { value: option })));
  drafted(context, id, field.base, select, rawText(field.value));
  select.setAttribute('aria-label', label);
  select.addEventListener('change', () => writeField(context, field, select.value === '' ? null : select.value));
  return select;
}

/** An input of the field's kind; a change goes to the GM when the player leaves the input or presses Enter. */
function input(context: StatblockContext, field: SheetField, value: SheetValue, label: string, id: string): HTMLElement {
  if (field.type === 'choice' && field.numbered !== true) return field.several === true ? picks(context, field, label, id) : choice(context, field, label, id);
  const long = field.type === 'markdown';
  const element = drafted(context, id, field.base, long ? node('textarea', 'book-input book-area sb-input') : node('input', 'book-input sb-input'), rawText(field.value));
  element.setAttribute('aria-label', label);
  element.maxLength = long ? MAX_FIELD_TEXT : MAX_BOOK_TITLE;
  if (value.prompt !== null) element.placeholder = value.prompt;
  if (element instanceof HTMLInputElement && field.type === 'number') {
    element.type = 'number';
    element.inputMode = 'decimal';
  }
  element.addEventListener('change', () => writeField(context, field, typedValue(field, element.value)));
  return element;
}

/** Where a value is something the player may change: an input of its kind, with its unit and its roll beside it. */
export function fieldEditor(context: StatblockContext, field: SheetField, value: SheetValue, id: string): HTMLElement {
  const label = value.label ?? field.key;
  const editor = node('span', 'sb-editor');
  if (field.type === 'scores' || field.type === 'pairs' || field.type === 'counters') editor.append(node('span', 'sb-plain', value.text.opening));
  else editor.append(input(context, field, value, label, id));
  if (field.unit !== undefined) editor.append(node('span', 'sb-unit', field.unit));
  if (value.roll !== undefined) editor.append(rollButton(context, value.roll, label, '🎲'));
  return editor;
}
