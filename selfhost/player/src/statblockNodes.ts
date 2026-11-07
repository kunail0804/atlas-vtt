import type { SheetCounter, SheetField, SheetNode } from '../../../src/app/online/protocol/book.ts';
import { button, node } from './bookDom.ts';
import type { StatblockContext } from './statblockContext.ts';
import { boxes, stepper, writeResource } from './statblockControls.ts';
import { writeField } from './statblockFields.ts';
import { tableElement } from './statblockTables.ts';
import { valueElement } from './statblockValues.ts';
import { TEXT } from './text.ts';

type TrackNode = Extract<SheetNode, { k: 'track' }>;
type CountersNode = Extract<SheetNode, { k: 'counters' }>;

/** Most boxes a counter row draws; a larger one shows its numbers with −/+. */
const MAX_COUNTER_BOXES = 20;

/** Sets a track: its resource where it shows one, else its field where the player may change it. */
function trackSetter(context: StatblockContext, track: TrackNode): ((current: number) => void) | null {
  if (!context.editable) return null;
  const resource = track.resource === null ? undefined : context.resources.find((entry) => entry.key === track.resource);
  if (resource !== undefined) return resource.editable ? (current) => void writeResource(context, resource.key ?? '', current) : null;
  const field = track.field;
  return field === null ? null : (current) => void writeField(context, field, Math.max(0, Math.min(track.max, current)));
}

/** A track: boxes or a gauge of `current` of `max`, set by a press where the player may. */
function trackElement(context: StatblockContext, track: TrackNode): HTMLElement {
  const element = node('div', 'sb-track');
  const label = track.label ?? '';
  if (track.label !== null) element.append(node('span', 'sb-label', track.label));
  // A track of the character's resource shows the book's own number, which follows the GM's at once.
  const held = track.resource === null ? undefined : context.resources.find((entry) => entry.key === track.resource);
  const current = held?.current ?? track.current;
  const set = trackSetter(context, track);
  if (track.look === 'boxes') {
    element.append(boxes(label, track.max, current, set));
    return element;
  }
  const gauge = node('span', 'sb-gauge');
  const fill = node('span', 'sb-gauge-fill');
  fill.style.width = `${track.max <= 0 ? 0 : Math.max(0, Math.min(100, (current / track.max) * 100))}%`;
  gauge.append(fill);
  const shown = node('span', 'sb-number', `${current} / ${track.max}`);
  element.append(gauge, set === null ? shown : stepper(label, shown, (delta) => set(current + delta)));
  return element;
}

/** Sends a Counters block back whole with one row's uses changed, as the GM takes it. */
function writeCounters(context: StatblockContext, field: SheetField, rows: readonly SheetCounter[], at: number, used: number): void {
  const value = rows.map((row, index) => ({ name: row.name, max: row.max, used: index === at ? Math.max(0, Math.min(row.max, used)) : row.used, reset: row.reset, regain: row.regain }));
  writeField(context, field, value);
}

/** Things with limited uses: a row each, its uses marked, given back by the refill or recovery it names. */
function countersElement(context: StatblockContext, counters: CountersNode): HTMLElement {
  const element = node('div', 'sb-counters');
  if (counters.label !== null) element.append(node('span', 'sb-label', counters.label));
  const field = context.editable ? counters.field : null;
  counters.counters.forEach((row, at) => {
    const line = node('div', 'sb-counter');
    line.append(node('span', 'sb-counter-name', row.name));
    const set = field === null ? null : (used: number): void => writeCounters(context, field, counters.counters, at, used);
    if (row.max <= MAX_COUNTER_BOXES) line.append(boxes(row.name, row.max, row.used, set));
    else {
      const shown = node('span', 'sb-number', `${row.used} / ${row.max}`);
      line.append(set === null ? shown : stepper(row.name, shown, (delta) => set(row.used + delta)));
    }
    const notes = [row.reset === null ? null : TEXT.sheet.resets(row.reset), row.regain === null ? null : TEXT.sheet.regains(row.regain)].filter((part) => part !== null);
    if (notes.length > 0) line.append(node('span', 'sb-counter-note', notes.join(' · ')));
    element.append(line);
  });
  return element;
}

/** A block with tabs: the tab the player chose, kept across redraws by the block's place. */
function tabsElement(context: StatblockContext, tabs: Extract<SheetNode, { k: 'tabs' }>, id: string): HTMLElement {
  const element = node('section', 'sb-section sb-tabbed');
  if (tabs.heading !== null) element.append(node('h4', 'sb-heading', tabs.heading));
  const chosen = Math.min(context.ui.tabs.get(id) ?? 0, tabs.tabs.length - 1);
  const bar = node('div', 'sb-tabs');
  tabs.tabs.forEach((tab, index) => {
    const choice = button(tab.label, () => {
      context.ui.tabs.set(id, index);
      context.redraw();
    }, 'book-tab sb-tab');
    choice.setAttribute('aria-pressed', String(index === chosen));
    bar.append(choice);
  });
  element.append(bar, ...nodesElements(context, tabs.tabs[chosen]?.nodes ?? [], `${id}.${chosen}`));
  return element;
}

/** One block of the sheet; `id` is its place, which names its inputs and its tabs. */
export function nodeElement(context: StatblockContext, block: SheetNode, id: string): HTMLElement {
  const element = drawn(context, block, id);
  if (block.frame !== undefined) {
    element.dataset.block = block.frame.block;
    if (block.frame.look !== undefined) element.dataset.frameLook = block.frame.look;
    if (block.frame.size !== undefined) element.dataset.size = block.frame.size;
    if (block.frame.align !== undefined) element.dataset.align = block.frame.align;
  }
  return element;
}

function drawn(context: StatblockContext, block: SheetNode, id: string): HTMLElement {
  switch (block.k) {
    case 'section': {
      const element = node('section', 'sb-section');
      if (block.heading !== null) element.append(node('h4', 'sb-heading', block.heading));
      element.append(...nodesElements(context, block.nodes, id));
      return element;
    }
    case 'row': {
      const element = node('div', 'sb-row');
      element.append(...nodesElements(context, block.nodes, id));
      return element;
    }
    case 'tabs': return tabsElement(context, block, id);
    case 'heading': return node(block.minor ? 'h5' : 'h4', block.minor ? 'sb-heading sb-minor' : 'sb-heading', block.text);
    case 'value': return valueElement(context, block.value, id);
    case 'metric': {
      const element = node('div', 'sb-metric');
      if (block.heading !== null) element.append(node('span', 'sb-label', block.heading));
      const values = node('div', 'sb-row');
      values.append(...block.values.map((value, index) => valueElement(context, value, `${id}.${index}`)));
      element.append(values);
      return element;
    }
    case 'table': return tableElement(context, block);
    case 'track': return trackElement(context, block);
    case 'counters': return countersElement(context, block);
    case 'divider': return node('hr', 'sb-divider');
  }
}

/** Blocks in their order, each named by its place under `id`. */
export function nodesElements(context: StatblockContext, nodes: readonly SheetNode[], id: string): HTMLElement[] {
  return nodes.map((block, index) => nodeElement(context, block, `${id}.${index}`));
}
