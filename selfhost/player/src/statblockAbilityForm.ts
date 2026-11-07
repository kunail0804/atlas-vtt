import type { AbilityComponent, AbilityEntry, AbilityPart, AbilityTab, SheetRaw } from '../../../src/app/online/protocol/book.ts';
import { MAX_FIELD_TEXT } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import { button, node } from './bookDom.ts';
import { drafted, type StatblockContext } from './statblockContext.ts';
import { rawText } from './statblockFields.ts';
import { TEXT } from './text.ts';

/** The drafts of the ability being written live under one prefix, so they go together. */
const PREFIX = 'ability.';
/** The base the form's drafts are kept against: the form's own, not a value of the note. */
const FORM = 'form';

const draftId = (name: string): string => `${PREFIX}${name}`;

function clearForm(context: StatblockContext): void {
  for (const key of [...context.drafts.keys()].filter((draft) => draft.startsWith(PREFIX))) context.drafts.delete(key);
  context.ui.ability = null;
}

/**
 * Opens the form on an ability (null: a new one, after `after`). It starts from the ability as the
 * note writes it, `@` references and all, where the GM sent that; a long text is fetched whole first.
 */
export async function startAbility(context: StatblockContext, list: string, entry: AbilityEntry | null, after: string | null = null): Promise<void> {
  clearForm(context);
  const text = entry?.written?.text ?? entry?.text;
  const whole = text?.whole === undefined ? undefined : context.texts.get(text.whole.id) ?? await context.assets.text(text.whole).catch(() => undefined);
  if (text?.whole !== undefined && whole !== undefined) context.texts.set(text.whole.id, whole);
  const parts = { ...entry?.parts, ...entry?.written?.parts };
  context.drafts.set(`${draftId('name')}@${FORM}`, entry?.written?.name ?? entry?.name ?? '');
  context.drafts.set(`${draftId('text')}@${FORM}`, whole ?? text?.opening ?? '');
  for (const [key, value] of Object.entries(parts)) context.drafts.set(`${draftId(`part.${key}`)}@${FORM}`, rawText(value));
  context.ui.ability = { list, key: entry?.key ?? null, after };
  context.redraw();
}

/** A part as typed: of its kind, none where it is empty. */
function typedPart(part: AbilityPart, text: string): SheetRaw | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (part.type === 'number') {
    const number = Number(trimmed.replace(',', '.'));
    return Number.isFinite(number) ? number : trimmed;
  }
  if (part.type === 'list' || (part.type === 'choice' && part.several === true)) return trimmed.split(',').map((item) => item.trim()).filter((item) => item !== '');
  return trimmed;
}

/** The input of a part: a choice of its options where it has them, else a line (a list as words separated by commas). */
function partInput(context: StatblockContext, part: AbilityPart): HTMLElement {
  const id = draftId(`part.${part.key}`);
  const label = node('label', 'sb-form-field');
  label.append(node('span', 'sb-label', part.label));
  if (part.type === 'choice' && part.several !== true && part.options !== undefined) {
    const select = node('select', 'book-input');
    select.append(Object.assign(node('option', '', TEXT.sheet.choose), { value: '' }), ...part.options.map((option) => Object.assign(node('option', '', option), { value: option })));
    label.append(drafted(context, id, FORM, select, ''));
    return label;
  }
  const input = drafted(context, id, FORM, node('input', 'book-input'), '');
  input.maxLength = MAX_BOOK_TITLE;
  if (part.type === 'number') input.inputMode = 'decimal';
  if (part.options !== undefined) input.placeholder = part.options.join(', ');
  label.append(input);
  return label;
}

/** The form that writes an ability of a list of the player's: its name, text and parts. */
export function abilityForm(context: StatblockContext, component: AbilityComponent, tab: AbilityTab, entry: AbilityEntry | null): HTMLFormElement {
  const form = node('form', 'book-form sb-ability-form');
  const name = drafted(context, draftId('name'), FORM, node('input', 'book-input'), '');
  name.maxLength = MAX_BOOK_TITLE;
  name.placeholder = TEXT.sheet.abilities.name;
  name.setAttribute('aria-label', TEXT.sheet.abilities.name);
  name.required = true;
  const text = drafted(context, draftId('text'), FORM, node('textarea', 'book-input book-area'), '');
  text.maxLength = MAX_FIELD_TEXT;
  text.placeholder = TEXT.sheet.abilities.text;
  text.setAttribute('aria-label', TEXT.sheet.abilities.text);
  const save = node('button', 'book-button book-primary', TEXT.sheet.abilities.save);
  save.type = 'submit';
  form.append(name, ...component.parts.map((part) => partInput(context, part)), text, save, button(TEXT.sheet.abilities.cancel, () => {
    clearForm(context);
    context.redraw();
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (name.value.trim() === '') return;
    const parts: Record<string, SheetRaw> = {};
    for (const part of component.parts) {
      const value = typedPart(part, context.drafts.get(`${draftId(`part.${part.key}`)}@${FORM}`) ?? '');
      if (value !== undefined) parts[part.key] = value;
    }
    const written = { name: name.value.trim(), text: text.value, parts };
    const after = context.ui.ability?.after ?? null;
    const sent = entry === null
      ? context.write({ t: 'book-ability', op: 'add', list: tab.list, after, entry: written })
      : context.write({ t: 'book-ability', op: 'edit', list: tab.list, key: entry.key, entry: written });
    // A refused ability stays in the form, as typed, for the player to fix.
    if (!sent) return;
    clearForm(context);
    context.redraw();
  });
  return form;
}
