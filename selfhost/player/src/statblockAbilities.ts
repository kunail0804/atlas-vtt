import type { AbilityComponent, AbilityEntry, AbilityTab, SheetRaw } from '../../../src/app/online/protocol/book.ts';
import { button, node } from './bookDom.ts';
import { abilityForm, startAbility } from './statblockAbilityForm.ts';
import type { StatblockContext } from './statblockContext.ts';
import { rawText } from './statblockFields.ts';
import { sheetText } from './statblockValues.ts';
import { TEXT } from './text.ts';

/** An ability's parts as one line: "Coût : Action · Dégâts : 1d8". */
function partsLine(component: AbilityComponent, entry: AbilityEntry): string {
  return component.parts
    .map((part) => ({ part, value: entry.parts[part.key] as SheetRaw | undefined }))
    .filter(({ value }) => value !== undefined && rawText(value) !== '')
    .map(({ part, value }) => `${part.label} : ${rawText(value ?? null)}`)
    .join(' · ');
}

/** One ability: its name, parts and text, with its Modifier and Supprimer where the list is the player's. */
function entryElement(context: StatblockContext, component: AbilityComponent, tab: AbilityTab, entry: AbilityEntry, mine: boolean): HTMLElement {
  const draft = context.ui.ability;
  if (mine && draft !== null && draft.list === tab.list && draft.key === entry.key) return abilityForm(context, component, tab, entry);
  const card = node('article', 'sb-ability');
  card.append(node('h5', 'sb-ability-name', entry.name));
  const parts = partsLine(component, entry);
  if (parts !== '') card.append(node('p', 'sb-ability-parts', parts));
  if (entry.text.opening !== '') card.append(sheetText(context, entry.text, true));
  if (mine) {
    const actions = node('div', 'sb-actions');
    actions.append(
      button(TEXT.sheet.abilities.edit, () => void startAbility(context, tab.list, entry)),
      button(TEXT.sheet.abilities.remove, () => void context.write({ t: 'book-ability', op: 'remove', list: tab.list, key: entry.key })),
    );
    card.append(actions);
  }
  return card;
}

/** A list of abilities: its intro, its abilities, and a way to add one where the list is the player's. */
function tabElement(context: StatblockContext, component: AbilityComponent, tab: AbilityTab): HTMLElement {
  const element = node('div', 'sb-ability-list');
  if (tab.intro !== undefined) element.append(sheetText(context, tab.intro, true));
  if (component.spells === true) {
    const names = node('p', 'sb-spells', tab.entries.map((entry) => entry.name).join(', '));
    element.append(names);
    return element;
  }
  const mine = context.editable && component.access === 'edit';
  element.append(...tab.entries.map((entry) => entryElement(context, component, tab, entry, mine)));
  if (!mine) return element;
  const draft = context.ui.ability;
  if (draft !== null && draft.list === tab.list && draft.key === null) element.append(abilityForm(context, component, tab, null));
  else element.append(button(TEXT.sheet.abilities.add, () => void startAbility(context, tab.list, null, tab.entries.at(-1)?.key ?? null), 'book-button book-primary'));
  return element;
}

/** An Abilities component: under the headings the GM's card gives it, its lists as tabs where it has several. */
export function abilityElement(context: StatblockContext, component: AbilityComponent): HTMLElement {
  const element = node('section', 'sb-section sb-abilities');
  // An older GM's Atlas names neither heading: the component's name stands for both.
  const heading = component.heading === undefined ? component.name : component.heading;
  if (component.section !== undefined && component.section !== null && component.section !== heading) element.append(node('h4', 'sb-heading', component.section));
  if (heading !== null) element.append(node('h4', 'sb-heading', heading));
  const id = `ability.${component.id}`;
  const chosen = Math.min(context.ui.tabs.get(id) ?? 0, component.tabs.length - 1);
  if (component.tabs.length > 1) {
    const bar = node('div', 'sb-tabs');
    component.tabs.forEach((tab, index) => {
      const choice = button(tab.label ?? String(index + 1), () => {
        context.ui.tabs.set(id, index);
        context.redraw();
      }, 'book-tab sb-tab');
      choice.setAttribute('aria-pressed', String(index === chosen));
      bar.append(choice);
    });
    element.append(bar);
  }
  const tab = component.tabs[chosen];
  if (tab !== undefined) element.append(tabElement(context, component, tab));
  return element;
}
