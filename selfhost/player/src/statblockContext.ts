import type { BookRestMessage, BookRestPick, BookStatblock, PlayerBookMessage, SheetResource } from '../../../src/app/online/protocol/book.ts';
import type { AssetLoader } from './assets.ts';

/** A rest the player is asking for, while its form is open: the button, its spends and the actions picked in its steps. */
export interface RestDraft {
  readonly button: string;
  readonly spends: number[];
  readonly picks: BookRestPick[];
}

/** The ability being written: its list, the entry it changes (null for a new one) and the entry it goes after. */
export interface AbilityDraft {
  readonly list: string;
  readonly key: string | null;
  readonly after: string | null;
}

/** What the statblock page shows besides the statblock: kept across redraws and statblocks, never sent. */
export interface StatblockUi {
  /** The tab shown of each tabbed block or ability component, by its place on the sheet. */
  readonly tabs: Map<string, number>;
  ability: AbilityDraft | null;
  rest: RestDraft | null;
  /** The rest request that waits for the GM's answer. */
  waiting: string | null;
}

/** What every part of the statblock page reads and how it writes. */
export interface StatblockContext {
  readonly statblock: BookStatblock;
  /** Whether the player may change anything of it: the statblock is editable and the page has the GM's book. */
  readonly editable: boolean;
  /** The character's resources, as the book last had them. */
  readonly resources: readonly SheetResource[];
  readonly assets: AssetLoader;
  /** What the player is typing, by field and the base it was typed against. */
  readonly drafts: Map<string, string>;
  /** The drafts this drawing used: the others belong to values the GM has since changed. */
  readonly used: Set<string>;
  /** Whole texts already fetched, by asset id, so a redraw shows them at once. */
  readonly texts: Map<string, string>;
  readonly ui: StatblockUi;
  /** Sends a change to the GM; false where it was not sent (the player was told why). */
  readonly write: (message: PlayerBookMessage) => boolean;
  readonly askRest: (message: BookRestMessage) => void;
  readonly roll: (formula: string, label: string) => void;
  readonly redraw: () => void;
}

/** A draft of one input: what the player typed against `base`, else `initial`; the input keeps `id` for the focus to come back. */
export function drafted<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(context: StatblockContext, id: string, base: string, element: T, initial: string): T {
  const key = `${id}@${base}`;
  context.used.add(key);
  element.value = context.drafts.get(key) ?? initial;
  element.dataset.field = id;
  element.addEventListener('input', () => context.drafts.set(key, element.value));
  return element;
}
