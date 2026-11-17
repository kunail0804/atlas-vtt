// @vitest-environment jsdom
import { Container, Graphics, TextureSource } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { describe, expect, it } from 'vitest';
import type { SharedToken } from '../../src/app/online/protocol/tokens.ts';
import type { PlayerMessage } from '../../src/app/online/protocol/game.ts';
import type { SnapGrid } from '../../src/app/online/protocol/moves.ts';
import type { AssetLoader, LoadedImage } from '../player/src/assets.ts';
import { TokenLayer } from '../player/src/tokenLayer.ts';

const A = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const B = 'b1b2c3d4e5f6a1b2c3d4e5f6';

const token = (id: string, changes: Partial<SharedToken> = {}): SharedToken => ({
  id, x: 100, y: 100, size: 70, cells: 1, rotation: 0, art: { id: `art-${id}`, hash: `hash-${id}` } as SharedToken['art'],
  name: id === A ? 'Mira' : 'Goblin', ring: { colour: '#ff0000', size: 84 }, claim: null, badge: null, ui: null, ...changes,
});

const viewport = { on: (): void => undefined, plugins: { pause: (): void => undefined, resume: (): void => undefined }, toWorld: (point: { x: number; y: number }) => point } as unknown as Viewport;
const assets = { image: async (): Promise<LoadedImage> => ({ bitmap: new TextureSource({ width: 64, height: 64 }) }) as unknown as LoadedImage } as unknown as AssetLoader;

/** The layer, its token groups by id, once the artwork of the first list has arrived. */
async function shownLayer(tokens: readonly SharedToken[]): Promise<{ tokens: TokenLayer; layer: Container }> {
  const layer = new Container();
  const layerOfTokens = new TokenLayer(layer, viewport, assets, () => undefined, () => null);
  layerOfTokens.show(tokens);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { tokens: layerOfTokens, layer };
}

/** Every display object under a token's group: the same objects after a list means nothing was redrawn. */
const objectsOf = (group: Container): Container[] => [group, ...group.children.flatMap((child) => objectsOf(child))];

describe('the player page\'s token layer', () => {
  it('redraws only the token whose look changed, and keeps a moved token\'s drawing', async () => {
    const { tokens, layer } = await shownLayer([token(A), token(B)]);
    const [groupA, groupB] = layer.children as Container[];
    const before = { a: objectsOf(groupA), b: objectsOf(groupB) };
    tokens.show([token(A, { x: 300, y: 250 }), token(B, { name: 'Goblin chief' })]);
    expect(groupA.position).toMatchObject({ x: 300, y: 250 });
    expect(objectsOf(groupA).every((node, index) => node === before.a[index])).toBe(true);
    expect(objectsOf(groupB).some((node, index) => node !== before.b[index])).toBe(true);
  });

  it('keeps a framed token\'s mask when its look changes', async () => {
    const { tokens, layer } = await shownLayer([token(A)]);
    const group = layer.children[0] as Container;
    const masks = (): Graphics[] => objectsOf(group).filter((node): node is Graphics => node instanceof Graphics && node.parent !== null && group.children.some((child) => child.mask === node));
    const [mask] = masks();
    expect(mask).toBeDefined();
    tokens.show([token(A, { name: 'Mira the bold', size: 90 })]);
    expect(masks()).toHaveLength(1);
    expect(masks()[0]).toBe(mask);
  });

  it('frees a removed token\'s shapes with their geometry', async () => {
    const { tokens, layer } = await shownLayer([token(A, { art: null }), token(B)]);
    const group = layer.children[0] as Container;
    const contexts = objectsOf(group).filter((node): node is Graphics => node instanceof Graphics).map((shape) => shape.context);
    expect(contexts.length).toBeGreaterThan(0);
    tokens.show([token(B)]);
    expect(group.destroyed).toBe(true);
    expect(contexts.every((context) => context.destroyed)).toBe(true);
  });
});

/** A layer whose drags can be played: the player owns A, the list carries `snap`. */
function draggableLayer(start: SharedToken, snap: SnapGrid | null): { drag: (to: { x: number; y: number }) => void; sent: PlayerMessage[]; group: () => Container } {
  let moveTo: ((event: unknown) => void) | null = null;
  const dragViewport = { ...viewport, on: (name: string, handler: (event: unknown) => void): void => { if (name === 'globalpointermove') moveTo = handler; } } as unknown as Viewport;
  const sent: PlayerMessage[] = [];
  const layer = new Container();
  const tokens = new TokenLayer(layer, dragViewport, assets, (message) => sent.push(message), () => 'me');
  tokens.reset('s1');
  tokens.show([start], snap);
  tokens.setMine([start.id]);
  const group = (): Container => layer.children[0] as Container;
  return {
    sent,
    group,
    drag: (to) => {
      group().emit('pointerdown', { button: 0, global: { x: start.x, y: start.y }, stopPropagation: () => undefined } as never);
      moveTo?.({ global: to });
      window.dispatchEvent(new Event('pointerup'));
    },
  };
}

const lastMove = (sent: readonly PlayerMessage[]): { x: number; y: number } | undefined => sent.filter((message) => message.t === 'move').at(-1) as { x: number; y: number } | undefined;
const SQUARE: SnapGrid = { type: 'square', size: 70, offsetX: 0, offsetY: 0 };
/** A hex's circumradius at size 70: its centre lies this far below the top of its box (pointy) or right of its left (flat). */
const R = 70 / Math.sqrt(3);

describe('a token the player drops', () => {
  it('lands in the centre of the square under it', () => {
    const { drag, sent, group } = draggableLayer(token(A, { x: 35, y: 35 }), SQUARE);
    drag({ x: 130, y: 160 });
    expect(lastMove(sent)).toMatchObject({ x: 105, y: 175 });
    expect(group().position).toMatchObject({ x: 105, y: 175 });
  });

  it('lands where its squares meet for an even footprint (Large, stored as 1.5)', () => {
    const { drag, sent } = draggableLayer(token(A, { x: 70, y: 70, size: 140, cells: 1.5 }), SQUARE);
    drag({ x: 130, y: 160 });
    expect(lastMove(sent)).toMatchObject({ x: 140, y: 140 });
  });

  it('lands in the centre of a pointy-top hex and on a vertex for an even footprint', () => {
    const grid: SnapGrid = { type: 'hex-vertical', size: 70, offsetX: 0, offsetY: 0 };
    const one = draggableLayer(token(A, { x: 35, y: R }), grid);
    one.drag({ x: 100, y: 50 });
    expect(lastMove(one.sent)?.x).toBeCloseTo(105);
    expect(lastMove(one.sent)?.y).toBeCloseTo(R);
    const two = draggableLayer(token(A, { x: 200, y: 200, size: 140, cells: 1.5 }), grid);
    two.drag({ x: 75, y: 60 });
    expect(lastMove(two.sent)?.x).toBeCloseTo(70);
    expect(lastMove(two.sent)?.y).toBeCloseTo(R * 1.5);
  });

  it('lands in the centre of a flat-top hex', () => {
    const { drag, sent } = draggableLayer(token(A, { x: R, y: 35 }), { type: 'hex-horizontal', size: 70, offsetX: 0, offsetY: 0 });
    drag({ x: 95, y: 75 });
    expect(lastMove(sent)?.x).toBeCloseTo(R * 2.5);
    expect(lastMove(sent)?.y).toBeCloseTo(70);
  });

  it('follows the grid\'s offsets', () => {
    const { drag, sent } = draggableLayer(token(A, { x: 45, y: 40 }), { ...SQUARE, offsetX: 10, offsetY: 5 });
    drag({ x: 130, y: 160 });
    expect(lastMove(sent)).toMatchObject({ x: 115, y: 180 });
  });

  it('stays where it was let go of without a grid to snap to', () => {
    const { drag, sent, group } = draggableLayer(token(A, { x: 35, y: 35 }), null);
    drag({ x: 130, y: 160 });
    expect(lastMove(sent)).toMatchObject({ x: 130, y: 160 });
    expect(group().position).toMatchObject({ x: 130, y: 160 });
  });

  it('goes back into its own square without a move when let go of there', () => {
    const { drag, sent, group } = draggableLayer(token(A, { x: 105, y: 105 }), SQUARE);
    drag({ x: 120, y: 112 });
    expect(lastMove(sent)).toBeUndefined();
    expect(sent.at(-1)).toMatchObject({ t: 'drag-cancel' });
    expect(group().position).toMatchObject({ x: 105, y: 105 });
  });
});
