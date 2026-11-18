import { setIcon } from 'obsidian';
import { scrollWithin } from '../../../utils/scrollWithin';
import { WIDGET_ICON_PATHS, WIDGET_ICON_VIEW_BOX } from '../../../types/widgetIcons';
import type { CampaignChoice } from '../campaignChoices.ts';
import { textButton } from './controls.ts';
import { t } from '../../../i18n';

/** The worlds a table can play, the one it would play now, and the table's players. */
export interface CampaignPick {
  /** Null while the worlds are not read yet. */
  readonly list: readonly CampaignChoice[] | null;
  /** The table's lasting players, who play whichever world it runs; 0 while their file is not read. */
  readonly players: number;
  /** The chosen world's id; null for none, which a table starts with unless the GM picks one. */
  readonly chosen: string | null;
  /** What the GM typed into the search; only campaigns whose name holds it show. */
  readonly query: string;
}

/** What the picker's controls do. */
export interface CampaignPickerActions {
  /** The table plays the world `campaignId`, or none (null). */
  choose(campaignId: string | null): void;
  /** Keeps what the GM typed, for the next drawing; the picker filters by itself, without one. */
  search(query: string): void;
  /** Starts the table with the chosen world, or none (Enter or a double click on a choice). */
  start(): void;
  /** Opens Atlas's dashboard, where campaigns are made. */
  openCampaigns(): void;
}

/** The world a table would start with: the one the GM picked while it is still there, else none. */
export function campaignPick(list: readonly CampaignChoice[] | null, players: number, picked: string | null, query = ''): CampaignPick {
  const chosen = picked !== null && list?.some((campaign) => campaign.id === picked) === true ? picked : null;
  return { list, players, chosen, query };
}

/** The `data-campaign` of the choice of no world: no world id is empty. */
const NO_WORLD = '';

/** Text compared without case or accents, so "eldritch" finds "Éldritch". */
const folded = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Whether a campaign called `name` shows for `query`: its name holds the query. */
export function matchesQuery(name: string, query: string): boolean {
  return folded(name).includes(folded(query.trim()));
}

function playersText(count: number): string {
  if (count === 0) return t('online.noPlayers');
  return t('online.players', { count });
}

/** The art of a campaign without a world map, as its dashboard card has it: its own tint and a d20. */
function emblem(parent: HTMLElement, hue: number): void {
  const art = parent.createSpan({ cls: 'campaign-emblem atlas-online-campaign__emblem', attr: { 'aria-hidden': 'true' } });
  art.style.setProperty('--campaign-hue', String(hue));
  const svg = art.createSvg('svg', { cls: 'campaign-emblem__icon', attr: { viewBox: WIDGET_ICON_VIEW_BOX, fill: 'currentColor' } });
  svg.createSvg('path', { attr: { d: WIDGET_ICON_PATHS.d20 } });
}

/** The art of the choice of no world: a struck-out circle on the frame's own fill. */
function noWorldArt(parent: HTMLElement): void {
  const frame = parent.createSpan({ cls: 'atlas-online-campaign__art atlas-online-campaign__art--none', attr: { 'aria-hidden': 'true' } });
  setIcon(frame, 'circle-off');
}

/** The world map's thumbnail; one the window has decoded before shows at once, a new one fades in. */
function thumbnail(parent: HTMLElement, choice: CampaignChoice): void {
  const frame = parent.createSpan({ cls: 'atlas-online-campaign__art', attr: { 'aria-hidden': 'true' } });
  frame.style.setProperty('--campaign-hue', String(choice.hue));
  if (choice.art === null) return emblem(frame, choice.hue);
  const image = frame.createEl('img', { attr: { src: choice.art, alt: '', decoding: 'async', draggable: 'false' } });
  if (image.complete) image.addClass('is-loaded');
  else image.addEventListener('load', () => image.addClass('is-loaded'), { once: true });
  image.addEventListener('error', () => {
    image.remove();
    emblem(frame, choice.hue);
  }, { once: true });
}

/** The radios the search leaves shown, in order. */
const shownRadios = (group: HTMLElement): HTMLElement[] => [...group.querySelectorAll<HTMLElement>('[role="radio"]:not([hidden])')];

/** Moves the choice among the shown campaigns with the arrow keys, Home and End, as a radio group does; Enter starts. */
function onKey(event: KeyboardEvent, button: HTMLElement, group: HTMLElement, field: HTMLElement, actions: CampaignPickerActions): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    return actions.start();
  }
  const radios = shownRadios(group);
  const index = radios.indexOf(button);
  if (index === 0 && event.key === 'ArrowUp') {
    event.preventDefault();
    return field.focus();
  }
  const steps: Partial<Record<string, number>> = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: radios.length - 1 };
  const next = steps[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const target = radios[Math.max(0, Math.min(radios.length - 1, next))]?.dataset;
  if (target?.campaign === undefined) return;
  // The menu is drawn anew and gives focus back by this key: to the choice made now.
  button.dataset.focusKey = target.focusKey;
  actions.choose(target.campaign === NO_WORLD ? null : target.campaign);
}

/** A radio of the list: a world (`id`), or no world (null); `chosen` says the table starts with it. */
interface RadioRow {
  readonly id: string | null;
  readonly name: string;
  readonly meta: string;
  readonly art: (button: HTMLElement) => void;
}

function row(group: HTMLElement, radio: RadioRow, chosen: boolean, field: HTMLElement, actions: CampaignPickerActions): HTMLButtonElement {
  const value = radio.id ?? NO_WORLD;
  const button = group.createEl('button', {
    cls: ['atlas-online-campaign', ...(chosen ? ['is-chosen'] : [])],
    attr: { type: 'button', role: 'radio', 'aria-checked': String(chosen), tabindex: chosen ? '0' : '-1', 'data-focus-key': radio.id === null ? 'campaign-none' : `campaign-${radio.id}`, 'data-campaign': value },
  });
  radio.art(button);
  const text = button.createSpan({ cls: 'atlas-online-campaign__text' });
  const name = text.createSpan({ cls: 'atlas-online-campaign__name' });
  name.createEl('bdi', { text: radio.name });
  text.createSpan({ cls: 'atlas-online-campaign__meta', text: radio.meta });
  const tick = button.createSpan({ cls: 'atlas-online-campaign__tick', attr: { 'aria-hidden': 'true' } });
  setIcon(tick, 'check');
  button.addEventListener('click', () => actions.choose(radio.id));
  button.addEventListener('dblclick', () => actions.start());
  button.addEventListener('keydown', (event) => onKey(event, button, group, field, actions));
  return button;
}

const worldRow = (choice: CampaignChoice): RadioRow => ({ id: choice.id, name: choice.name, meta: choice.activity, art: (button) => thumbnail(button, choice) });

const NO_WORLD_ROW: RadioRow = { id: null, name: t('online.noWorld'), meta: t('online.noWorldDetail'), art: noWorldArt };

/** The search above the campaigns: a magnifier, the field and, once something is typed, a button that clears it. */
function searchField(parent: HTMLElement, query: string): { field: HTMLInputElement; clear: HTMLButtonElement } {
  const frame = parent.createDiv({ cls: 'atlas-online-campaigns__search' });
  setIcon(frame.createSpan({ cls: 'atlas-online-campaigns__search-icon', attr: { 'aria-hidden': 'true' } }), 'search');
  const field = frame.createEl('input', {
    cls: 'atlas-online-campaigns__search-field',
    attr: { type: 'search', placeholder: t('campaign.search'), 'aria-label': t('campaign.search'), spellcheck: 'false', autocomplete: 'off', 'data-focus-key': 'campaign-search' },
  });
  field.value = query;
  const clear = frame.createEl('button', { cls: 'atlas-online-campaigns__search-clear', attr: { type: 'button', 'aria-label': t('online.clearSearch'), tabindex: '-1' } });
  setIcon(clear, 'x');
  return { field, clear };
}

/**
 * The step before a table starts: which world it plays, if any. No world comes first and is chosen
 * until the GM picks a world; each world shows its world map, name and when it was played; the
 * chosen one is ringed and ticked. Above the worlds, the table says once how many players it has. The list has room for five and scrolls past them, and
 * the search above it finds a world by its name (no world always stays). A vault without worlds gets
 * the way to make one.
 */
export function renderCampaignPicker(parent: HTMLElement, pick: CampaignPick, actions: CampaignPickerActions, disabled = false): void {
  const section = parent.createDiv({ cls: 'atlas-online-campaigns' });
  section.createDiv({ cls: 'atlas-online-help atlas-online-campaigns__players', text: playersText(pick.players) });
  const label = section.createDiv({ cls: 'atlas-online-campaigns__label', text: t('online.campaignLabel') });
  label.id = `${parent.id || 'atlas-online'}-campaigns`;
  const list = pick.list;
  if (list === null) {
    section.createDiv({ cls: 'atlas-online-help atlas-online-campaigns__note', text: t('online.readingCampaigns') });
    return;
  }
  if (list.length === 0) {
    section.createDiv({ cls: 'atlas-online-help atlas-online-campaigns__note', text: t('online.noCampaigns') });
    textButton(section, t('online.openDashboard'), () => actions.openCampaigns()).dataset.focusKey = 'open-campaigns';
    return;
  }
  const { field, clear } = searchField(section, pick.query);
  const box = section.createDiv({ cls: 'atlas-online-campaigns__box' });
  const group = box.createDiv({ cls: 'atlas-online-campaigns__list', attr: { id: `${label.id}-list`, role: 'radiogroup', 'aria-labelledby': label.id } });
  field.setAttribute('aria-controls', group.id);
  row(group, NO_WORLD_ROW, pick.chosen === null, field, actions).disabled = disabled;
  const rows = list.map((choice) => {
    const button = row(group, worldRow(choice), choice.id === pick.chosen, field, actions);
    button.disabled = disabled;
    return { choice, button };
  });
  const none = box.createDiv({ cls: 'atlas-online-help atlas-online-campaigns__none', text: t('online.noCampaignMatch') });
  field.disabled = disabled;

  /** Shows the campaigns the search finds, and says so where it finds none. */
  const filter = (): CampaignChoice[] => {
    const found: CampaignChoice[] = [];
    for (const { choice, button } of rows) {
      button.hidden = !matchesQuery(choice.name, field.value);
      if (!button.hidden) found.push(choice);
    }
    none.hidden = found.length > 0;
    clear.hidden = field.value === '';
    return found;
  };
  filter();
  /** The chosen world stays while the search finds it, else the first one found takes its place; no world stays chosen. */
  const search = (): void => {
    actions.search(field.value);
    const found = filter();
    group.scrollTop = 0;
    const first = found[0];
    if (pick.chosen !== null && first !== undefined && !found.some((choice) => choice.id === pick.chosen)) actions.choose(first.id);
  };
  field.addEventListener('input', search);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (none.hidden) actions.start();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      (group.querySelector<HTMLElement>('[aria-checked="true"]:not([hidden])') ?? shownRadios(group)[0])?.focus();
    }
  });
  clear.addEventListener('click', () => {
    field.value = '';
    search();
    field.focus();
  });
  // Once drawn: the list is new each time, and starts at its top.
  group.win.requestAnimationFrame(() => {
    const chosen = group.querySelector('.is-chosen:not([hidden])');
    if (chosen !== null) scrollWithin(group, chosen, 'nearest');
  });
}
