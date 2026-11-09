import { button, node } from './bookDom.ts';
import type { StatblockContext } from './statblockContext.ts';
import { TEXT } from './text.ts';

/** A button that rolls `formula` for the character, named by what it rolls. */
export function rollButton(context: StatblockContext, formula: string, label: string, shown: string): HTMLButtonElement {
  const element = button(shown, () => context.roll(formula, label), 'sb-roll');
  element.setAttribute('aria-label', TEXT.sheet.roll(label));
  return element;
}

/** −/+ around a number the player may step. */
export function stepper(label: string, shown: HTMLElement, step: (delta: number) => void): HTMLElement {
  const row = node('span', 'sb-stepper');
  const lower = button('−', () => step(-1), 'book-button sb-step');
  lower.setAttribute('aria-label', TEXT.sheet.lower(label));
  const raise = button('+', () => step(1), 'book-button sb-step');
  raise.setAttribute('aria-label', TEXT.sheet.raise(label));
  row.append(lower, shown, raise);
  return row;
}

/** Sets a resource of the character, within its range; false where the player may not change it. */
export function writeResource(context: StatblockContext, key: string, current: number): boolean {
  const resource = context.resources.find((entry) => entry.key === key);
  if (!context.editable || resource === undefined || !resource.editable) return false;
  return context.write({ t: 'book-resource', key, current: Math.max(0, Math.min(resource.max, Math.round(current))) });
}

/**
 * A row of boxes, `filled` of `count` marked: a press on a box marks up to it, a press on the last
 * marked one clears it. Read only without `set`.
 */
export function boxes(label: string, count: number, filled: number, set: ((filled: number) => void) | null): HTMLElement {
  const row = node('span', 'sb-boxes');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${label} : ${filled} / ${count}`);
  for (let index = 1; index <= count; index++) {
    const box = node('button', index <= filled ? 'sb-box sb-box-filled' : 'sb-box');
    box.type = 'button';
    box.setAttribute('aria-label', TEXT.sheet.box(label, index));
    box.setAttribute('aria-pressed', String(index <= filled));
    if (set === null) box.disabled = true;
    else box.addEventListener('click', () => set(index === filled ? index - 1 : index));
    row.append(box);
  }
  return row;
}
