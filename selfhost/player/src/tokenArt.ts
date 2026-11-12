import { Graphics, Sprite, Texture, type Container } from 'pixi.js';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { destroyTree } from '../../../src/app/pixi/utils/destroyTree.ts';
import type { AssetLoader } from './assets.ts';

/** A token's art is asked for at most this large: tokens are small on screen. */
const TOKEN_ART_SIDE = 512;

/**
 * A token's artwork in its group, under `above` (the ring and the rest of its drawing): loaded once per
 * artwork, and framed by one disc that stays while the token has a ring.
 */
export class TokenArt {
  private readonly group: Container;
  private readonly above: Container;
  private readonly assets: AssetLoader;
  private token: SharedToken;
  private sprite: Sprite | null = null;
  private hash: string | null = null;
  private mask: Graphics | null = null;

  constructor(group: Container, above: Container, assets: AssetLoader, token: SharedToken) {
    this.group = group;
    this.above = above;
    this.assets = assets;
    this.token = token;
  }

  /** Shows the token's art as it is now: loads another artwork, then sizes, turns, tints and frames it. */
  show(token: SharedToken): void {
    this.token = token;
    if (token.art === null) {
      this.drop();
      return;
    }
    if (this.hash !== token.art.hash) this.load(token.art);
    this.fit();
  }

  private load(art: NonNullable<SharedToken['art']>): void {
    const hash = art.hash;
    this.hash = hash;
    this.assets.image(art, TOKEN_ART_SIDE).then((image) => {
      if (this.hash !== hash || this.group.destroyed) return;
      this.destroySprite();
      const sprite = new Sprite(Texture.from(image.bitmap));
      sprite.anchor.set(0.5);
      this.sprite = sprite;
      this.group.addChildAt(sprite, this.group.getChildIndex(this.above));
      this.fit();
    }).catch(() => undefined);
  }

  private fit(): void {
    const { sprite, token } = this;
    if (sprite === null) return;
    sprite.scale.set(token.size / Math.max(sprite.texture.width, sprite.texture.height));
    sprite.angle = token.rotation;
    // A downed creature is greyed out, under its skull.
    sprite.tint = token.ui?.downed === true ? 0x6b6b6b : 0xffffff;
    if (token.ring === null) {
      this.dropMask();
      return;
    }
    // A framed token shows its art as a disc inside the ring: one unit disc, scaled to the token.
    if (this.mask === null) {
      this.mask = new Graphics().circle(0, 0, 1).fill({ color: 0xffffff });
      this.group.addChildAt(this.mask, 0);
    }
    this.mask.scale.set(token.size / 2);
    sprite.mask = this.mask;
  }

  private drop(): void {
    this.dropMask();
    this.destroySprite();
    this.hash = null;
  }

  private dropMask(): void {
    if (this.mask === null) return;
    if (this.sprite !== null) this.sprite.mask = null;
    destroyTree(this.mask);
    this.mask = null;
  }

  private destroySprite(): void {
    if (this.sprite === null) return;
    // Unmasked first, so its mask effect goes back to PIXI's pool.
    this.sprite.mask = null;
    destroyTree(this.sprite);
    this.sprite = null;
  }
}
