// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingDrops } from '../player/src/tokenDrops.ts';

const ME = 'a'.repeat(20);
const OTHER = 'b'.repeat(20);

describe('a token waiting at its drop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays at the second drop when the end and the list of the first drag arrive late', () => {
    const drops = new PendingDrops(() => ME, () => undefined);
    // Dropped at (100, 100), taken again at once (a pick forgets the drop) and dropped at (300, 300).
    drops.put('t', 100, 100, 1);
    drops.forget('t');
    drops.put('t', 300, 300, 2);
    // The GM ends the first drag about a round trip late, then lists the token where it landed.
    expect(drops.shows({ id: 't', x: 100, y: 100, end: true, by: ME, drag: 1 })).toBe(false);
    expect(drops.shows({ id: 't', x: 100, y: 100, end: true, drag: 1 })).toBe(false);
    expect(drops.keeps({ id: 't', x: 100, y: 100 })).toBe(true);
    // The second drag's own end and the list that follows it land the drop.
    expect(drops.shows({ id: 't', x: 300, y: 300, end: true, drag: 2 })).toBe(true);
    expect(drops.keeps({ id: 't', x: 300, y: 300 })).toBe(false);
    expect(drops.shows({ id: 't', x: 500, y: 500, by: ME, drag: 3 })).toBe(true);
  });

  it('takes as its own echoes only the places that name this player, or name no one and carry one of their drags', () => {
    const drops = new PendingDrops(() => ME, () => undefined);
    drops.put('t', 300, 300, 2);
    expect(drops.echoes({ id: 't', x: 250, y: 250, by: ME, drag: 2 })).toBe(true);
    expect(drops.echoes({ id: 't', x: 250, y: 250, drag: 2 })).toBe(true);
    expect(drops.echoes({ id: 't', x: 50, y: 50, by: ME, drag: 1 })).toBe(true);
    // The GM's own drag, with cursors shown or not, and another player's.
    expect(drops.echoes({ id: 't', x: 250, y: 250, by: 'gm' })).toBe(false);
    expect(drops.echoes({ id: 't', x: 250, y: 250 })).toBe(false);
    expect(drops.echoes({ id: 't', x: 250, y: 250, by: OTHER, drag: 2 })).toBe(false);
  });

  it('moves with the GM\'s drag of the token while the player\'s drop waits', () => {
    const drops = new PendingDrops(() => ME, () => undefined);
    drops.put('t', 300, 300, 2);
    expect(drops.shows({ id: 't', x: 320, y: 300, by: 'gm' })).toBe(true);
    // The drop no longer waits: the GM's later places and end move the token too.
    expect(drops.echoes({ id: 't', x: 340, y: 300 })).toBe(false);
    expect(drops.keeps({ id: 't', x: 340, y: 300 })).toBe(false);
  });

  it('waits for its drag\'s end though a list already has it at the drop, so late echoes still move nothing', () => {
    const drops = new PendingDrops(() => ME, () => undefined);
    // A drag let go of within a pixel of where it began: the drop is where the token already stands.
    drops.put('t', 35, 35, 4);
    expect(drops.keeps({ id: 't', x: 35, y: 35 })).toBe(false);
    expect(drops.shows({ id: 't', x: 90, y: 35, by: ME, drag: 4 })).toBe(false);
    expect(drops.shows({ id: 't', x: 35, y: 35, end: true, by: ME, drag: 4 })).toBe(true);
    expect(drops.keeps({ id: 't', x: 35, y: 35 })).toBe(false);
    expect(drops.shows({ id: 't', x: 90, y: 35, by: 'gm' })).toBe(true);
  });

  it('gives up on a drop the GM says nothing of', () => {
    const expired = vi.fn();
    const drops = new PendingDrops(() => ME, expired);
    drops.put('t', 35, 35, 1);
    vi.advanceTimersByTime(2_000);
    // The GM still speaks of the drag: the drop waits as long again.
    drops.shows({ id: 't', x: 40, y: 35, by: ME, drag: 1 });
    vi.advanceTimersByTime(2_000);
    expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(expired).toHaveBeenCalledWith('t');
  });
});
