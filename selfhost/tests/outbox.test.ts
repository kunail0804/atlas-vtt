import { describe, expect, it } from 'vitest';
import { MAX_WINDOW_BYTES, MIN_WINDOW_BYTES, PlayerOutbox, SAMPLE_MS, TARGET_DELAY_MS } from '../relay/outbox.ts';

/** A bulk frame the size of an asset chunk with its envelope. */
const CHUNK = 'c'.repeat(65_700);

function outbox(acks: boolean): { box: PlayerOutbox; sent: string[]; clock: { now: number } } {
  const sent: string[] = [];
  const clock = { now: 0 };
  const box = new PlayerOutbox({ send: (text) => sent.push(text) }, acks, () => clock.now);
  return { box, sent, clock };
}

describe('the relay outbox of one player', () => {
  it('sends every frame at once to a page that does not ack', () => {
    const { box, sent } = outbox(false);
    for (let index = 0; index < 5; index += 1) box.sendBulk(CHUNK);
    for (let index = 0; index < 5; index += 1) box.sendOrdered(CHUNK, true);
    expect(sent).toHaveLength(10);
  });

  it('paces the parts of a large message, keeps later messages behind them, and lets live ones pass', () => {
    const { box, sent, clock } = outbox(true);
    const second = CHUNK.replace('c', 'd');
    box.sendOrdered(CHUNK, true);
    box.sendOrdered(second, true);
    box.sendOrdered('delta', false);
    box.sendBulk('chunk');
    // The window holds the first part only: the second waits, the delta keeps its place behind it, the chunk waits for all.
    expect(sent).toEqual([CHUNK]);
    box.sendLive('drag');
    expect(sent).toEqual([CHUNK, 'drag']);

    clock.now = 6_570;
    box.ack(1);
    expect(sent).toEqual([CHUNK, 'drag', second, 'delta', 'chunk']);
    expect(box.waitingCount).toBe(0);
  });

  it('holds bulk frames until the page acks, while other frames overtake them', () => {
    const { box, sent, clock } = outbox(true);
    for (let index = 0; index < 3; index += 1) box.sendBulk(CHUNK);
    expect(sent).toEqual([CHUNK]);
    expect(box.waitingCount).toBe(2);

    box.sendLive('move');
    box.sendOrdered('scene', false);
    expect(sent).toEqual([CHUNK, 'move', 'scene']);

    clock.now = 6_000;
    box.ack(1);
    expect(sent).toEqual([CHUNK, 'move', 'scene', CHUNK]);
    clock.now = 12_000;
    box.ack(2);
    expect(sent).toEqual([CHUNK, 'move', 'scene', CHUNK, CHUNK]);
    expect(box.waitingCount).toBe(0);
  });

  it('keeps one chunk on the way over a link of 10 KB/s, so a message waits at most about one chunk', () => {
    const { box, sent, clock } = outbox(true);
    for (let index = 0; index < 20; index += 1) box.sendBulk(CHUNK);
    // Each chunk takes 6.57 s to arrive at 10 KB/s.
    for (let acked = 1; acked <= 10; acked += 1) {
      clock.now += 6_570;
      box.ack(acked);
      expect(sent.length - acked).toBe(1);
    }
    expect(box.window).toBeLessThan(2 * CHUNK.length);
  });

  it('opens the window over a fast link until what is on the way takes about the target delay', () => {
    const sentAt: number[] = [];
    const clock = { now: 0 };
    const box = new PlayerOutbox({ send: () => sentAt.push(clock.now) }, true, () => clock.now);
    for (let index = 0; index < 400; index += 1) box.sendBulk(CHUNK);
    // A link of 2,000 bytes a millisecond with 25 ms each way: a frame crosses once it left and the one before it crossed.
    const speed = 2_000;
    const oneWay = 25;
    let crossedAt = 0;
    let acked = 0;
    while (acked < 300) {
      const leftAt = sentAt[acked] ?? 0;
      crossedAt = Math.max(crossedAt, leftAt + oneWay) + CHUNK.length / speed;
      clock.now = crossedAt + oneWay;
      acked += 1;
      box.ack(acked);
    }
    expect(box.window).toBeGreaterThan(speed * TARGET_DELAY_MS * 0.7);
    expect(box.window).toBeLessThan(speed * (TARGET_DELAY_MS + 1_000));
    expect(sentAt.length - acked).toBeGreaterThan(10);
  });

  it('is not fooled by acks that arrive together', () => {
    const { box, clock } = outbox(true);
    for (let index = 0; index < 10; index += 1) box.sendBulk(CHUNK);
    clock.now = 6_570;
    box.ack(1);
    // The next ack 1 ms later would read as 65 MB/s on its own; it only adds to a sample of at least SAMPLE_MS.
    clock.now += 1;
    box.ack(2);
    expect(box.window).toBeLessThan(MAX_WINDOW_BYTES);
    expect(box.window).toBe(MIN_WINDOW_BYTES);
    expect(SAMPLE_MS).toBeGreaterThan(1);
  });

  it('ignores acks for frames it never sent or already counted, and drops what waits once closed', () => {
    const { box, sent, clock } = outbox(true);
    for (let index = 0; index < 3; index += 1) box.sendBulk(CHUNK);
    box.ack(5);
    box.ack(0);
    expect(sent).toHaveLength(1);
    box.close();
    clock.now = 1_000;
    box.ack(1);
    box.sendBulk(CHUNK);
    box.sendOrdered('scene', false);
    box.sendLive('move');
    expect(sent).toHaveLength(1);
    expect(box.waitingCount).toBe(0);
  });
});
