import { describe, expect, it } from 'vitest';
import { stampSize } from '../../../../src/app/annotations/drawSizes';
import { parsePlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import { CELL, LOOK, next, table } from './drawTable.ts';
import { ANA, SCENE } from './realStore.ts';

// The fork's stamp: its player page stamps symbols, which upstream's Draw tool requests carry no word for (`draw-stamp`).
describe('a symbol a player stamps', () => {
  it('is made as the GM\'s Stamp mode makes it, in the player\'s colour and size, marked with who made it', () => {
    const { send, drawn, refusals } = table();
    send(ANA, { t: 'draw-stamp', scene: SCENE, n: next(), x: 300, y: 200, icon: 'door-open', look: { colour: '#e93147', size: 'l' } });
    const made = drawn().find((drawing) => drawing.by === ANA);
    expect(made).toMatchObject({ kind: 'drawing', type: 'icon', icon: 'door-open', by: ANA, color: '#e93147', width: stampSize('l', CELL), points: [{ x: 300, y: 200 }] });
    expect(refusals()).toEqual([]);
  });

  it('is refused for a symbol no stamp shows, off the map, or while the GM does not let players draw', () => {
    const harness = table();
    harness.send(ANA, { t: 'draw-stamp', scene: SCENE, n: next(), x: 300, y: 200, icon: 'not-a-symbol', look: LOOK });
    harness.send(ANA, { t: 'draw-stamp', scene: SCENE, n: next(), x: 90_000, y: 200, icon: 'skull', look: LOOK });
    harness.allowed = false;
    harness.send(ANA, { t: 'draw-stamp', scene: SCENE, n: next(), x: 300, y: 200, icon: 'skull', look: LOOK });
    expect(harness.drawn().filter((drawing) => drawing.by === ANA)).toEqual([]);
    expect(harness.refusals()).toEqual(['shape', 'place', 'off']);
  });

  it('is read on the wire only with a place, a symbol\'s name and a look', () => {
    const stamp = { t: 'draw-stamp', scene: SCENE, n: 1, x: 10, y: 20, icon: 'skull', look: LOOK };
    expect(parsePlayerMessage(stamp)).toEqual(stamp);
    expect(parsePlayerMessage({ ...stamp, look: { ...LOOK, seeThrough: true } })).toEqual(stamp);
    for (const broken of [{ icon: 'Skull!' }, { x: 'far' }, { look: { colour: 'red', size: 'm' } }]) expect(parsePlayerMessage({ ...stamp, ...broken })).toBeNull();
  });
});
