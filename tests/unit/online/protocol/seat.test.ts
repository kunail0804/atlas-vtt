import { describe, expect, it } from 'vitest';
import { MAX_SEAT_ALIASES, parseSeats, parseYourCode } from '../../../../src/app/online/protocol/index.ts';

describe('the player\'s own code', () => {
  it('is read from a your-code message', () => {
    expect(parseYourCode({ t: 'your-code', code: '482193', first: true })).toEqual({ t: 'your-code', code: '482193', first: true });
    expect(parseYourCode({ t: 'your-code', code: '000001', first: false })).toEqual({ t: 'your-code', code: '000001', first: false });
  });

  it('is refused when the code is not six digits, the flag is no boolean, or the body is something else', () => {
    for (const body of [
      { t: 'your-code', code: '48219', first: true }, { t: 'your-code', code: '4821930', first: true }, { t: 'your-code', code: 482193, first: true }, { t: 'your-code', code: '482193', first: 'yes' },
      { t: 'your-code', code: '482193' }, { t: 'your-code', first: true }, { t: 'other', code: '482193', first: true }, null, undefined, 'your-code', [], 7,
    ]) expect(parseYourCode(body), JSON.stringify(body)).toBeNull();
  });
});

describe('the campaign\'s seats the relay is told', () => {
  const seat = { id: 'a'.repeat(20), name: 'Ana', code: '000001' };

  it('carry the ids a player had before the GM merged its players, and none where the list is empty', () => {
    expect(parseSeats([{ ...seat, was: ['b'.repeat(20)] }])).toEqual([{ ...seat, was: ['b'.repeat(20)] }]);
    expect(parseSeats([{ ...seat, was: [] }])).toEqual([seat]);
    expect(parseSeats([seat])).toEqual([seat]);
  });

  it('are refused where the earlier ids are no list of player ids, or too many', () => {
    for (const was of ['b'.repeat(20), ['nope'], [7], Array.from({ length: MAX_SEAT_ALIASES + 1 }, () => 'b'.repeat(20))]) {
      expect(parseSeats([{ ...seat, was }]), JSON.stringify(was)).toBeNull();
    }
  });
});
