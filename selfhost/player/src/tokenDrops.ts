import type { LivePlace } from '../../../src/app/online/protocol/live.ts';

/**
 * How long a dropped token waits where it was put down while the GM says nothing of its drag (no echo,
 * no end, no list that lands it, no refusal) before it goes back where the list has it: the GM may have
 * gone without answering.
 */
const SETTLE_MS = 3_000;
/** A drop the list lands within this distance is the place the page sent (the GM rounds places). */
const SAME_PLACE = 1;

/**
 * A token this player put down and the GM has not answered for yet: it stays at `x`, `y`. `drag` is the
 * number of the drag that put it down. `ended` once the lane's end of that drag came, after which a live
 * place is someone's new drag.
 */
interface PendingDrop {
  x: number;
  y: number;
  readonly drag: number;
  ended: boolean;
  timer: number;
}

/**
 * The player's drops the GM has not answered yet. The GM echoes a drag about a round trip late, so the
 * echo of the drag's middle, the end of an earlier drag and a list sent before the drop still arrive
 * after the token was put down; until the drag's end has come and a list lands the drop (or the GM
 * refuses it) the token stays where it was put down.
 *
 * A live place is the player's own when it names them (`by`, while everyone sees cursors), or, naming
 * no one, when it carries the number of one of their drags up to the one waiting (`drag`). A place
 * that is neither (the GM's own drag, another player's, a GM that numbers no drags) is someone's new
 * drag and moves the token.
 */
export class PendingDrops {
  private readonly drops = new Map<string, PendingDrop>();
  private readonly self: () => string | null;
  private readonly expired: (id: string) => void;

  /**
   * `self` is this player's relay id, null before the table welcomed them; `expired` hears of a drop the
   * GM said nothing of for `SETTLE_MS`: its token goes back where the list has it.
   */
  constructor(self: () => string | null, expired: (id: string) => void) {
    this.self = self;
    this.expired = expired;
  }

  put(id: string, x: number, y: number, drag: number): void {
    this.forget(id);
    this.drops.set(id, { x, y, drag, ended: false, timer: this.expiry(id) });
  }

  /**
   * Whether a listed token stays at its drop: true while the list does not have it there yet. A list that
   * has it there before the drag's end came keeps the drop waiting, since that drag's late echoes may follow.
   */
  keeps(token: { readonly id: string; readonly x: number; readonly y: number }): boolean {
    const drop = this.drops.get(token.id);
    if (drop === undefined) return false;
    if (Math.hypot(token.x - drop.x, token.y - drop.y) > SAME_PLACE) return true;
    if (drop.ended) this.forget(token.id);
    return false;
  }

  /**
   * Whether a live place is the late echo of the player's own drag, which neither moves the token nor
   * draws its ruler: of a drag before the one waiting, or of the one waiting while the GM has not ended it.
   */
  echoes(place: LivePlace): boolean {
    const drop = this.drops.get(place.id);
    if (drop === undefined || !this.ours(place, drop)) return false;
    if (this.earlier(place, drop)) return true;
    return !drop.ended && place.end !== true;
  }

  /** Whether the token is drawn at a live place: not the late echo of the player's own drag. */
  shows(place: LivePlace): boolean {
    const drop = this.drops.get(place.id);
    if (drop === undefined) return true;
    const current = this.ours(place, drop) && !this.earlier(place, drop);
    // The GM still speaks of the drag that waits: the drop waits as long again.
    if (current) {
      window.clearTimeout(drop.timer);
      drop.timer = this.expiry(place.id);
    }
    if (this.echoes(place)) return false;
    if (current && place.end === true) {
      // Where the GM landed the drop, which the list will say too.
      drop.x = place.x;
      drop.y = place.y;
      drop.ended = true;
      return true;
    }
    this.forget(place.id);
    return true;
  }

  forget(id: string): void {
    const drop = this.drops.get(id);
    if (drop === undefined) return;
    window.clearTimeout(drop.timer);
    this.drops.delete(id);
  }

  clear(): void {
    for (const id of [...this.drops.keys()]) this.forget(id);
  }

  /** Whether a place is of this player's drags: it names them, or names no one and carries the number of one up to the drop's. */
  private ours(place: LivePlace, drop: PendingDrop): boolean {
    if (place.by !== undefined) return place.by === this.self();
    return place.drag !== undefined && place.drag <= drop.drag;
  }

  /** Whether one of this player's places is of a drag before the drop's. */
  private earlier(place: LivePlace, drop: PendingDrop): boolean {
    return place.drag !== undefined && place.drag < drop.drag;
  }

  private expiry(id: string): number {
    return window.setTimeout(() => {
      this.drops.delete(id);
      this.expired(id);
    }, SETTLE_MS);
  }
}
