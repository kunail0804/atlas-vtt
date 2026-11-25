import { describe, expect, it } from 'vitest';
import { parsePlayerMark, type PlayerMeasure } from '../../../../src/app/online/protocol/index.ts';
import { lastMarks, markHarness } from './markHarness.ts';

const TESTEUR = 'a'.repeat(20);

/**
 * A player's measurement reaches the GM and the other players (#181). A page tells it in the
 * player's colour at the table, read from the page's styles, which is no laser swatch: the GM took
 * only swatches and dropped every measurement a page sent.
 */
describe('a player\'s measurement', () => {
  // The players' page's red (`page.css`), and the GM's accent the page told measurements in before.
  for (const color of ['#e35d5d', '#8a5cf5']) {
    it(`told in ${color} is shown to the GM and sent on to everyone`, () => {
      const harness = markHarness();
      harness.share.setScene('s1');
      const message = parsePlayerMark({ t: 'measure', scene: 's1', color, live: { shape: 'circle', a: [100, 100], b: [240, 100] }, kept: [] }) as PlayerMeasure;
      expect(message).not.toBeNull();
      harness.share.receive(TESTEUR, message);
      expect(harness.shown?.measures).toEqual([expect.objectContaining({ who: TESTEUR, live: { shape: 'circle', a: [100, 100], b: [240, 100] } })]);
      harness.advance(200);
      const sent = lastMarks(harness)?.measures.find((measure) => measure.who === TESTEUR);
      expect(sent).toMatchObject({ color, live: { shape: 'circle', a: [100, 100], b: [240, 100] } });
    });
  }
});
