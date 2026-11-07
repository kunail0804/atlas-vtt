import { describe, expect, it } from 'vitest';
import { parseGmMessage, type GmMessage } from '../../../../src/app/online/protocol/index.ts';
import type { TokenEntity } from '../../../../src/app/types';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import { HP, STRESS } from '../../../mocks/resourceFixtures';
import { boundOwnership } from './fakeSeats.ts';
import { pngOf } from './fakeTileCache.ts';
import { sceneState, shareHarness, token, tokenLists, type ShareHarness } from './shareHarness.ts';

// What the fork adds to upstream's scene share: a player's own bars in `mine`, and players' drawings and texts.

const ANA = 'a'.repeat(20);
const BEN = 'b'.repeat(20);
const ART = new Map([['maps/cave.webp', pngOf(400, 300)]]);
/** Hit points players see, and a stress track they do not: only its owner sees that one. */
const RULES = { resources: [{ ...HP, visibleToPlayers: true }, { ...STRESS, visibleToPlayers: false }], conditions: [] };
const HERO: TokenEntity = { ...token('hero', { x: 1 }), kind: 'character', name: 'Hero', resources: { hp: { current: 7, max: 10 }, stress: { current: 2, max: 6 } } } as TokenEntity;

type Table = ShareHarness & { readonly scene: string; readonly hero: string };

async function table(): Promise<Table> {
  const owners = boundOwnership([{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }]);
  owners.welcome([{ id: ANA, name: 'Ana' }, { id: BEN, name: 'Ben' }]);
  const state = sceneState({ objects: { ...sceneState().objects, tokens: { hero: HERO } } });
  const share = shareHarness(state, ART, owners);
  share.rules = RULES;
  owners.onChange(() => share.share.ownersChanged());
  share.share.start();
  await share.set(state);
  await share.advance(TOKEN_INTERVAL_MS);
  owners.give(['hero'], {}, ANA);
  await share.advance(TOKEN_INTERVAL_MS);
  const list = tokenLists(share.sent).at(-1);
  return Object.assign(share, { scene: list?.scene ?? '', hero: list?.tokens[0]?.id ?? '' });
}

const lastTo = <T extends GmMessage['t']>(sent: ShareHarness['sent'], t: T, to: string): Extract<GmMessage, { t: T }> | undefined =>
  sent.flatMap(({ body, to: sentTo }) => (body.t === t && sentTo === to ? [body as Extract<GmMessage, { t: T }>] : [])).at(-1);

describe('the fork\'s additions to the scene share', () => {
  it('sends a player the bars of their own token as its owner sees them, the hidden ones too, and nobody else', async () => {
    const gm = await table();
    const mine = lastTo(gm.sent, 'mine', ANA);
    expect(mine?.tokens).toEqual([gm.hero]);
    expect(mine?.bars?.[gm.hero]?.map((bar) => [bar.current, bar.max])).toEqual([[7, 10], [2, 6]]);
    expect(parseGmMessage(JSON.parse(JSON.stringify(mine)))).toEqual(mine);
    expect(lastTo(gm.sent, 'mine', BEN)?.bars).toBeUndefined();
  });

  it('keeps a player\'s drawing and text on the map as Atlas\'s own, marked with who made them', async () => {
    const gm = await table();
    gm.share.receive(ANA, { t: 'draw', scene: gm.scene, id: '1'.repeat(24), drawing: { type: 'pen', points: [10, 10, 50, 40], colour: '#ff0000', width: 4 } });
    gm.share.receive(ANA, { t: 'place-text', scene: gm.scene, id: '2'.repeat(24), text: { x: 100, y: 80, text: 'Ici', fontSize: 24, colour: '#000000', bold: false } });
    await gm.settle();
    const { drawings, texts } = gm.state().objects;
    expect(drawings[`drawing_player_${'1'.repeat(24)}`]).toMatchObject({ author: ANA, points: [{ x: 10, y: 10 }, { x: 50, y: 40 }] });
    expect(texts[`text_player_${'2'.repeat(24)}`]).toMatchObject({ author: ANA, text: 'Ici' });
  });
});
