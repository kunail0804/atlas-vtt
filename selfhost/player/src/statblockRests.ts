import type { BookRecoveryButton, BookRecoveryChoice, BookRecoverySpend, BookRestPick } from '../../../src/app/online/protocol/book.ts';
import { button, node, randomId } from './bookDom.ts';
import type { RestDraft, StatblockContext } from './statblockContext.ts';
import { TEXT } from './text.ts';

/** A number input of a spend rule, 0 to its most, written into `units` at `index` as it is typed. */
function spendInput(spend: BookRecoverySpend, units: number[], index: number, id: string): HTMLElement {
  const label = node('label', 'sb-form-field');
  const input = node('input', 'book-input sb-spend');
  input.type = 'number';
  input.min = '0';
  input.max = String(spend.most);
  input.step = '1';
  input.value = String(units[index] ?? 0);
  input.dataset.field = id;
  input.addEventListener('input', () => {
    units[index] = Math.max(0, Math.min(spend.most, Math.floor(Number(input.value) || 0)));
  });
  label.append(node('span', 'sb-label', TEXT.sheet.rests.spend(spend.label, spend.most)), input);
  return label;
}

/** One action picked in a step: for whom, its spends, and a × to take it back. */
function pickElement(context: StatblockContext, choice: BookRecoveryChoice, pick: BookRestPick, draft: RestDraft, at: number): HTMLElement {
  const action = choice.actions.find((entry) => entry.id === pick.action);
  const element = node('div', 'sb-rest-pick');
  element.append(node('strong', '', action?.name ?? pick.action));
  const allies = context.statblock.allies ?? [];
  if (action?.forOthers === true && allies.length > 0) {
    const whom = node('select', 'book-input');
    whom.setAttribute('aria-label', TEXT.sheet.rests.forWhom);
    whom.append(Object.assign(node('option', '', TEXT.sheet.rests.self), { value: '' }), ...allies.map((ally) => Object.assign(node('option', '', ally.name), { value: ally.id })));
    whom.value = pick.for ?? '';
    whom.addEventListener('change', () => {
      draft.picks[at] = { ...pick, for: whom.value === '' ? null : whom.value };
    });
    element.append(whom);
  }
  const units = pick.spends as number[];
  (action?.spends ?? []).forEach((spend, index) => element.append(spendInput(spend, units, index, `rest.pick.${at}.${index}`)));
  const remove = button('×', () => {
    draft.picks.splice(at, 1);
    context.redraw();
  }, 'sb-chip-remove');
  remove.setAttribute('aria-label', TEXT.sheet.remove(action?.name ?? pick.action));
  element.append(remove);
  return element;
}

/** A step of a rest: its prompt, the actions it offers, and those picked. */
function stepElement(context: StatblockContext, choice: BookRecoveryChoice, draft: RestDraft): HTMLElement {
  const element = node('fieldset', 'sb-rest-step');
  element.append(node('legend', '', `${choice.prompt} (${TEXT.sheet.rests.picks(choice.min, choice.max)})`));
  const picked = draft.picks.filter((pick) => pick.choice === choice.id);
  for (const action of choice.actions) {
    const already = picked.some((pick) => pick.action === action.id);
    const offer = button(TEXT.sheet.rests.take(action.name), () => {
      draft.picks.push({ choice: choice.id, action: action.id, for: null, spends: action.spends.map(() => 0) });
      context.redraw();
    });
    offer.disabled = picked.length >= choice.max || (already && !choice.repeat);
    element.append(offer);
    if (action.text !== '') element.append(node('p', 'sb-rest-action', action.text));
  }
  draft.picks.forEach((pick, at) => {
    if (pick.choice === choice.id) element.append(pickElement(context, choice, pick, draft, at));
  });
  return element;
}

/** Whether every step has as many actions picked as it asks for. */
function complete(recovery: BookRecoveryButton, draft: RestDraft): boolean {
  return (recovery.choices ?? []).every((choice) => {
    const count = draft.picks.filter((pick) => pick.choice === choice.id).length;
    return count >= choice.min && count <= choice.max;
  });
}

/** The form of a rest the player asks for: what they spend, the actions of its steps, and the request to the GM. */
function restForm(context: StatblockContext, recovery: BookRecoveryButton, draft: RestDraft, character: string): HTMLElement {
  const form = node('form', 'book-form sb-rest-form');
  form.append(node('h5', 'sb-heading sb-minor', recovery.name));
  recovery.spends.forEach((spend, index) => form.append(spendInput(spend, draft.spends, index, `rest.spend.${index}`)));
  for (const choice of recovery.choices ?? []) form.append(stepElement(context, choice, draft));
  const ask = node('button', 'book-button book-primary', TEXT.sheet.rests.ask);
  ask.type = 'submit';
  ask.disabled = !complete(recovery, draft);
  form.append(ask, button(TEXT.sheet.rests.cancel, () => {
    context.ui.rest = null;
    context.redraw();
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!complete(recovery, draft)) return;
    const request = randomId();
    context.askRest({ t: 'book-rest', request, character, button: recovery.id, spends: [...draft.spends], ...(draft.picks.length > 0 && { picks: draft.picks.map((pick) => ({ ...pick, spends: [...pick.spends] })) }) });
    context.ui.rest = null;
    context.ui.waiting = request;
    context.redraw();
  });
  return form;
}

/**
 * The sheet's refills and recovery buttons. A refill is taken at once (`book-refill`); a rest is
 * asked of the GM (`book-rest`) through its form, and the page waits for the GM's answer.
 */
export function restsElement(context: StatblockContext): HTMLElement | null {
  const { refills = [], recovery = [], characterId } = context.statblock;
  if (!context.editable || (refills.length === 0 && (recovery.length === 0 || characterId === undefined))) return null;
  const element = node('section', 'sb-section sb-rests');
  element.append(node('h4', 'sb-heading', TEXT.sheet.rests.title));
  const buttons = node('div', 'sb-actions');
  for (const refill of refills) buttons.append(button(refill.name, () => void context.write({ t: 'book-refill', refill: refill.name })));
  if (characterId !== undefined) {
    for (const rest of recovery) {
      const open = button(rest.name, () => {
        context.ui.rest = { button: rest.id, spends: rest.spends.map(() => 0), picks: [] };
        context.redraw();
      });
      open.disabled = context.ui.waiting !== null;
      buttons.append(open);
    }
  }
  element.append(buttons);
  if (context.ui.waiting !== null) element.append(node('p', 'book-empty', TEXT.sheet.rests.waiting));
  const draft = context.ui.rest;
  const chosen = draft === null ? undefined : recovery.find((rest) => rest.id === draft.button);
  if (draft !== null && chosen !== undefined && characterId !== undefined && context.ui.waiting === null) element.append(restForm(context, chosen, draft, characterId));
  return element;
}
