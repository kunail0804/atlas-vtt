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
 * A token this player put down and the GM has not answered for yet: it stays at `x`, `y`. `ended` once
 * the lane's end of the drag came, after which a live place is someone's new drag.
 */
interface PendingDrop {
  x: number;
  y: number;
  ended: boolean;
  timer: number;
}

/**
 * The player's drops the GM has not answered yet. The GM echoes a drag about a round trip late, so the
 * echo of the drag's middle, and a list sent before the drop, still arrive after the token was put
 * down; until a list lands the drop (or the GM refuses it) the token stays where it was put down.
 */
export class PendingDrops {
  private readonly drops = new Map<string, PendingDrop>();
  private readonly expired: (id: string) => void;

  /** `expired` hears of a drop the GM said nothing of for `SETTLE_MS`: its token goes back where the list has it. */
  constructor(expired: (id: string) => void) {
    this.expired = expired;
  }

  put(id: string, x: number, y: number): void {
    this.forget(id);
    this.drops.set(id, { x, y, ended: false, timer: this.expiry(id) });
  }

  /** Whether a listed token stays at its drop: true while the list does not have it there yet. */
  keeps(token: { readonly id: string; readonly x: number; readonly y: number }): boolean {
    const drop = this.drops.get(token.id);
    if (drop === undefined) return false;
    if (Math.hypot(token.x - drop.x, token.y - drop.y) <= SAME_PLACE) {
      this.forget(token.id);
      return false;
    }
    return true;
  }

  /**
   * Whether a live place is the late echo of the player's own drag, which neither moves the token nor
   * draws its ruler: the GM has not ended the drag of a drop it has not answered yet.
   */
  echoes(place: LivePlace): boolean {
    const drop = this.drops.get(place.id);
    return drop !== undefined && !drop.ended && place.end !== true;
  }

  /** Whether the token is drawn at a live place: not the late echo of the player's own drag. */
  shows(place: LivePlace): boolean {
    const drop = this.drops.get(place.id);
    if (drop === undefined) return true;
    window.clearTimeout(drop.timer);
    drop.timer = this.expiry(place.id);
    if (place.end === true) {
      // Where the GM landed the drop, which the list will say too.
      drop.x = place.x;
      drop.y = place.y;
      drop.ended = true;
      return true;
    }
    if (this.echoes(place)) return false;
    this.forget(place.id);
    return true;
  }

  forget(id: string): void {
    const drop = this.drops.get(id);
    if (drop === undefined) return;
    window.clearTimeout(drop.timer);
    this.drops.delete(id);
  }

  private expiry(id: string): number {
    return window.setTimeout(() => {
      this.drops.delete(id);
      this.expired(id);
    }, SETTLE_MS);
  }

  clear(): void {
    for (const id of [...this.drops.keys()]) this.forget(id);
  }
}
