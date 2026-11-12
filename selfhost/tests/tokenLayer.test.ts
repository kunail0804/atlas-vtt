// @vitest-environment jsdom
import { Container, Graphics, TextureSource } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { describe, expect, it } from 'vitest';
import type { SharedToken } from '../../src/app/online/protocol/tokens.ts';
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
  const layerOfTokens = new TokenLayer(layer, viewport, assets, () => undefined);
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
