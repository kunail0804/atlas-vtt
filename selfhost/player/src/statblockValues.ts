import type { SheetPair, SheetText, SheetValue } from '../../../src/app/online/protocol/book.ts';
import { node } from './bookDom.ts';
import { rollButton, stepper, writeResource } from './statblockControls.ts';
import { markdownBlocks } from './markdownText.ts';
import { fieldEditor } from './statblockFields.ts';
import { listEditor } from './statblockLists.ts';
import type { StatblockContext } from './statblockContext.ts';
import { TEXT } from './text.ts';

/**
 * A text of the sheet: its opening at once, the whole once it is fetched by hash (kept, so a redraw
 * shows it without waiting). Markdown is drawn with elements and text nodes only.
 */
export function sheetText(context: StatblockContext, text: SheetText, markdown: boolean): HTMLElement {
  const element = node('div', markdown ? 'sb-text doc-text' : 'sb-text');
  const fill = (shown: string): void => {
    if (markdown) element.replaceChildren(...markdownBlocks(shown));
    else element.textContent = shown;
  };
  const whole = text.whole;
  const held = whole === undefined ? undefined : context.texts.get(whole.id);
  fill(held ?? text.opening);
  if (whole !== undefined && held === undefined) {
    context.assets.text(whole).then((loaded) => {
      context.texts.set(whole.id, loaded);
      fill(loaded);
    }).catch(() => undefined);
  }
  return element;
}

/** A value that is a resource of the character (hit points): the book's numbers, stepped where the player may. */
function resourceValue(context: StatblockContext, key: string, value: SheetValue): HTMLElement {
  const resource = context.resources.find((entry) => entry.key === key);
  if (resource === undefined) return node('span', 'sb-plain', value.text.opening);
  const shown = node('span', 'sb-number', resource.direction === 'static' ? String(resource.max) : `${resource.current} / ${resource.max}`);
  if (!context.editable || !resource.editable || resource.direction === 'static') return shown;
  return stepper(value.label ?? resource.name, shown, (delta) => void writeResource(context, key, resource.current + delta));
}

function pairElement(context: StatblockContext, pair: SheetPair): HTMLElement {
  const shown = `${pair.label} ${pair.value}`;
  return pair.roll === undefined ? node('span', 'sb-chip', shown) : rollButton(context, pair.roll, pair.label, shown);
}

/** What a value shows when it is not edited: its text in its look, a roll where it has one. */
function shownValue(context: StatblockContext, value: SheetValue): HTMLElement {
  if (value.look === 'words' && value.words !== undefined) {
    const words = node('span', 'sb-chips');
    words.append(...value.words.map((word) => node('span', 'sb-chip', word)));
    return words;
  }
  if (value.look === 'pairs' && value.pairs !== undefined) {
    const pairs = node('span', 'sb-chips');
    pairs.append(...value.pairs.map((pair) => pairElement(context, pair)));
    return pairs;
  }
  if (value.look === 'markdown') return sheetText(context, value.text, true);
  const text = value.text.opening === '' ? value.prompt ?? TEXT.sheet.empty : value.text.opening;
  if (value.roll !== undefined) return rollButton(context, value.roll, value.label ?? text, text);
  return node('span', value.text.opening === '' ? 'sb-plain sb-prompt' : 'sb-plain', text);
}

/** One value of the sheet with its label; `id` names it on the page, for the focus to come back to it. */
export function valueElement(context: StatblockContext, value: SheetValue, id: string): HTMLElement {
  const element = node('div', 'sb-value');
  element.dataset.look = value.look;
  if (value.label !== null) element.append(node('span', 'sb-label', value.label));
  const field = context.editable ? value.field : null;
  if (value.resource !== undefined) element.append(resourceValue(context, value.resource, value));
  else if (field !== null && (field.type === 'list' || field.type === 'pairs') && (value.look === 'words' || value.look === 'pairs')) element.append(listEditor(context, value, field));
  else if (field !== null) element.append(fieldEditor(context, field, value, id));
  else element.append(shownValue(context, value));
  return element;
}
