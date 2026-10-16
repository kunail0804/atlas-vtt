import { MAX_MAP_TITLE, MAX_PIN_BODY, PIN_KINDS, type BookPin, type MapPlace, type PinKind } from '../../../src/app/online/protocol/bookMap.ts';
import type { MapEntrance } from '../../../src/app/online/protocol/bookLevels.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import { PIN_ICON_PATHS, resolvePinIcon } from '../../../src/app/types/pinIcons.ts';
import type { PageContext } from './bookContext.ts';
import { assetImage, bound, button, glyph, node, randomId } from './bookDom.ts';
import { TEXT } from './text.ts';

/** The largest side a map of the book is asked for at. */
const MAP_SIDE = 4096;

/** The plugin's glyph for each kind of the player's pins. */
const KIND_ICONS: Readonly<Record<PinKind, keyof typeof PIN_ICON_PATHS>> = { treasure: 'treasure', danger: 'combat', dungeon: 'dungeon', person: 'npc', note: 'note' };

interface ShownMap {
  readonly id: string | null;
  readonly title: string;
  readonly image: AssetRef;
  readonly entrances: readonly MapEntrance[];
}

/** The map the tab shows: the world map, or a map its entrances lead into (back to the world map where that one is gone). */
function shownMap(context: PageContext): ShownMap | null {
  const world = context.book.worldMap;
  if (world === null) return null;
  const nested = context.ui.mapId === null ? undefined : world.maps?.find((map) => map.id === context.ui.mapId);
  if (nested !== undefined) return { id: nested.id, title: nested.title, image: nested.image, entrances: nested.entrances };
  context.ui.mapId = null;
  return { id: null, title: TEXT.map.world, image: world.image, entrances: world.entrances ?? [] };
}

/** A marker at a place on the map, in shares of its sides. */
function marker(place: MapPlace, className: string, label: string, content: Node, act: () => void): HTMLButtonElement {
  const element = node('button', `map-marker ${className}`);
  element.type = 'button';
  element.setAttribute('aria-label', label);
  element.style.left = `${place.x * 100}%`;
  element.style.top = `${place.y * 100}%`;
  element.append(content);
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    act();
  });
  return element;
}

function entranceFace(entrance: MapEntrance): Node {
  if (entrance.label !== undefined) return node('span', 'map-marker-label', entrance.label);
  const icon = resolvePinIcon(entrance.icon);
  const path = (PIN_ICON_PATHS as Record<string, string>)[icon] ?? PIN_ICON_PATHS.pin;
  return glyph(path, 'map-marker-glyph');
}

/** The form for a new pin at `place`, or for `pin` itself. */
function pinForm(context: PageContext, map: ShownMap, place: MapPlace, pin: BookPin | null): HTMLElement {
  const form = node('form', 'book-form map-card');
  const key = pin?.id ?? 'new';
  const kind = bound(context.drafts, `pin.${key}.kind`, node('select', 'book-input'), pin?.kind ?? 'note');
  for (const option of PIN_KINDS) {
    const element = node('option', '', TEXT.map.kinds[option]);
    element.value = option;
    kind.append(element);
  }
  kind.value = context.drafts.get(`pin.${key}.kind`) ?? pin?.kind ?? 'note';
  const title = bound(context.drafts, `pin.${key}.title`, node('input', 'book-input'), pin?.title ?? '');
  title.placeholder = TEXT.map.title;
  title.maxLength = MAX_MAP_TITLE;
  const body = bound(context.drafts, `pin.${key}.body`, node('textarea', 'book-input book-area'), pin?.body ?? '');
  body.placeholder = TEXT.map.body;
  body.maxLength = MAX_PIN_BODY;
  const save = node('button', 'book-button book-primary', TEXT.map.save);
  save.type = 'submit';
  const forget = (): void => {
    for (const field of ['kind', 'title', 'body']) context.drafts.delete(`pin.${key}.${field}`);
  };
  form.append(kind, title, body, save);
  if (pin === null) form.append(button(TEXT.map.cancel, () => {
    forget();
    context.ui.pinDraft = null;
    context.redraw();
  }));
  else form.append(button(TEXT.map.remove, () => {
    forget();
    context.ui.selected = null;
    context.write({ t: 'book-pin-delete', id: pin.id });
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    forget();
    context.ui.pinDraft = null;
    context.ui.selected = null;
    const id = pin?.id ?? randomId();
    context.write({ t: 'book-pin', pin: { id, ...(map.id !== null && { map: map.id }), x: place.x, y: place.y, kind: kind.value as PinKind, title: title.value, body: body.value } });
  });
  return form;
}

/** What is chosen on the map, under it: an entrance to go through, a quest to open, the player's pin to change. */
function selectedCard(context: PageContext, map: ShownMap, pins: readonly BookPin[]): HTMLElement | null {
  if (context.ui.pinDraft !== null) return pinForm(context, map, context.ui.pinDraft, null);
  const selected = context.ui.selected;
  if (selected === null) return null;
  if (selected.kind === 'pin') {
    const pin = pins.find((candidate) => candidate.id === selected.id);
    return pin === undefined ? null : pinForm(context, map, pin, pin);
  }
  if (selected.kind === 'entrance') {
    const entrance = map.entrances.find((candidate) => candidate.to === selected.id);
    if (entrance === undefined) return null;
    const card = node('div', 'map-card');
    card.append(node('h4', 'book-item-name', entrance.title), button(TEXT.map.enter, () => {
      context.ui.mapId = entrance.to;
      context.ui.selected = null;
      context.redraw();
    }, 'book-button book-primary'));
    return card;
  }
  const quest = context.book.quests.find((candidate) => candidate.id === selected.id);
  if (quest === undefined) return null;
  const card = node('div', 'map-card');
  card.append(node('h4', 'book-item-name', quest.title), node('p', 'book-item-meta', TEXT.quests.states[quest.state]), button(TEXT.quests.open, () => {
    context.ui.tab = 'quests';
    context.ui.selected = null;
    context.redraw();
  }, 'book-button book-primary'));
  return card;
}

export function worldMapPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const map = shownMap(context);
  if (map === null) {
    page.append(node('p', 'book-empty', TEXT.book.noMap));
    return page;
  }
  const head = node('div', 'map-head');
  if (map.id !== null) head.append(button(TEXT.map.back, () => {
    context.ui.mapId = null;
    context.ui.selected = null;
    context.ui.pinDraft = null;
    context.redraw();
  }));
  head.append(node('h3', 'book-name map-title', map.title), button(context.ui.placing ? TEXT.map.cancel : TEXT.map.addPin, () => {
    context.ui.placing = !context.ui.placing;
    context.ui.pinDraft = null;
    context.redraw();
  }, context.ui.placing ? 'book-button book-primary' : 'book-button'));
  page.append(head);
  if (context.ui.placing) page.append(node('p', 'book-item-meta', TEXT.map.placing));

  const frame = node('div', context.ui.placing ? 'map-frame map-placing' : 'map-frame');
  frame.append(assetImage(context.assets, map.image, MAP_SIDE, 'book-map'));
  const choose = (kind: 'pin' | 'entrance' | 'quest', id: string): void => {
    context.ui.selected = { kind, id };
    context.ui.pinDraft = null;
    context.redraw();
  };
  for (const entrance of map.entrances) frame.append(marker(entrance, 'map-entrance', entrance.title, entranceFace(entrance), () => choose('entrance', entrance.to)));
  if (map.id === null) for (const quest of context.book.quests) {
    if (quest.place !== null) frame.append(marker(quest.place, `map-quest${context.ui.selected?.id === quest.id ? ' map-chosen' : ''}`, quest.title, glyph(PIN_ICON_PATHS.quest, 'map-marker-glyph'), () => choose('quest', quest.id)));
  }
  const pins = context.book.pins.filter((pin) => (pin.map ?? null) === map.id);
  for (const pin of pins) {
    frame.append(marker(pin, `map-pin map-pin-${pin.kind}${context.ui.selected?.id === pin.id ? ' map-chosen' : ''}`, pin.title === '' ? TEXT.map.kinds[pin.kind] : pin.title, glyph(PIN_ICON_PATHS[KIND_ICONS[pin.kind]], 'map-marker-glyph'), () => choose('pin', pin.id)));
  }
  frame.addEventListener('click', (event) => {
    if (!context.ui.placing) return;
    const box = frame.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const share = (value: number): number => Math.max(0, Math.min(1, value));
    context.ui.pinDraft = { x: share((event.clientX - box.left) / box.width), y: share((event.clientY - box.top) / box.height) };
    context.ui.placing = false;
    context.ui.selected = null;
    context.redraw();
  });
  if (context.ui.pinDraft !== null) frame.append(marker(context.ui.pinDraft, 'map-pin map-draft', TEXT.map.addPin, node('span', 'map-marker-label', '+'), () => undefined));
  page.append(frame);
  const card = selectedCard(context, map, pins);
  if (card !== null) page.append(card);
  return page;
}
