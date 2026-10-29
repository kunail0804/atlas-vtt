import type { PlayerBook, PlayerBookMessage } from '../../../src/app/online/protocol/book.ts';
import type { MapPlace } from '../../../src/app/online/protocol/bookMap.ts';
import type { AssetLoader } from './assets.ts';

export type Tab = 'character' | 'sheet' | 'documents' | 'compendium' | 'items' | 'equipment' | 'notes' | 'quests' | 'purse' | 'map';

/** What the book shows besides the book itself: kept across redraws, never sent. */
export interface BookUi {
  tab: Tab;
  /** The map the world map tab shows: null for the world map itself. */
  mapId: string | null;
  /** The next touch on the map places a pin there. */
  placing: boolean;
  /** Where a new pin goes, while its form is open. */
  pinDraft: MapPlace | null;
  /** What on the map is chosen: its card shows under the map. */
  selected: { readonly kind: 'pin' | 'entrance' | 'quest'; readonly id: string } | null;
  /** The note being edited in each list (`free` or a quest's id). */
  readonly editing: Map<string, string>;
  /** Rows of the purse beyond those the book holds. */
  extraCoins: number;
}

/** What every page reads and how it writes: the book as the page holds it, and the way to the GM. */
export interface PageContext {
  readonly book: PlayerBook;
  readonly assets: AssetLoader;
  /** False where the page did not take the write (malformed, too long, a full book): the player was told. */
  readonly write: (message: PlayerBookMessage) => boolean;
  readonly redraw: () => void;
  readonly drafts: Map<string, string>;
  readonly ui: BookUi;
}
