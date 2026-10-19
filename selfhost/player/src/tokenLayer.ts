import { Circle, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { LivePlace } from '../../../src/app/online/protocol/live.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import type { SharedBar } from '../../../src/app/online/protocol/tokenUI.ts';
import { loadedTokenRingTexture, loadTokenRingTexture } from '../../../src/app/pixi/token-renderer/tokenRingTexture.ts';
import type { AssetLoader } from './assets.ts';
import { drawTokenUI } from './tokenUI.ts';

/** A token's art is asked for at most this large: tokens are small on screen. */
const TOKEN_ART_SIDE = 512;
/** Drags go out at most this often, as the GM's own live messages do (`LIVE_INTERVAL_MS`). */
const DRAG_INTERVAL_MS = 33;

interface Drawn {
  token: SharedToken;
  readonly group: Container;
  art: Sprite | null;
  artHash: string | null;
}

/**
 * The tokens the players see, in the GM's drawing order. A player drags only their own tokens:
 * the page sends where the token is while it moves (`drag`) and where it was put down (`move`);
 * the GM checks the move and the next token list says where it stands.
 */
export class TokenLayer {
  private readonly layer: Container;
  private readonly viewport: Viewport;
  private readonly assets: AssetLoader;
  private readonly send: (message: PlayerMessage) => void;
  private readonly drawn = new Map<string, Drawn>();
  private mine = new Set<string>();
  /** The bars of the player's own tokens as their owner sees them, by id: shown in place of those everyone sees. */
  private ownBars: Readonly<Record<string, readonly SharedBar[]>> = {};
  private scene: string | null = null;
  private dragging: { id: string; offsetX: number; offsetY: number; lastSent: number } | null = null;
  /** Off while the laser or the ruler holds the pointer. */
  private dragsEnabled = true;

  constructor(layer: Container, viewport: Viewport, assets: AssetLoader, send: (message: PlayerMessage) => void) {
    this.layer = layer;
    this.viewport = viewport;
    this.assets = assets;
    this.send = send;
    // Moves anywhere on the canvas, and a release anywhere in the window, end up here: a token
    // dragged fast leaves its own shape, and a release outside the canvas must still put it down.
    viewport.on('globalpointermove', (event: FederatedPointerEvent) => this.dragTo(event));
    window.addEventListener('pointerup', () => this.drop());
    window.addEventListener('pointercancel', () => this.drop());
    // Tokens drawn before the ring's artwork arrived show a plain ring until then.
    if (loadedTokenRingTexture() === null) {
      void loadTokenRingTexture().then((texture) => {
        if (texture !== null) for (const drawn of this.drawn.values()) this.draw(drawn);
      });
    }
  }

  /** A new scene: every token goes. */
  reset(scene: string | null): void {
    this.scene = scene;
    this.mine = new Set();
    this.ownBars = {};
    this.dragging = null;
    this.viewport.plugins.resume('drag');
    for (const drawn of this.drawn.values()) drawn.group.destroy({ children: true });
    this.drawn.clear();
  }

  setDragsEnabled(enabled: boolean): void {
    this.dragsEnabled = enabled;
  }

  setMine(ids: readonly string[], bars: Readonly<Record<string, readonly SharedBar[]>> = {}): void {
    this.mine = new Set(ids);
    this.ownBars = bars;
    for (const drawn of this.drawn.values()) this.draw(drawn);
  }

  /** The whole token list: tokens not in it go, the order is the list's. */
  show(tokens: readonly SharedToken[]): void {
    const kept = new Set(tokens.map((token) => token.id));
    for (const [id, drawn] of this.drawn) {
      if (kept.has(id)) continue;
      drawn.group.destroy({ children: true });
      this.drawn.delete(id);
    }
    tokens.forEach((token, index) => {
      let drawn = this.drawn.get(token.id);
      if (drawn === undefined) {
        drawn = this.create(token);
        this.drawn.set(token.id, drawn);
      }
      drawn.token = token;
      this.layer.setChildIndex(drawn.group, Math.min(index, this.layer.children.length - 1));
      // The token held by this player's pointer stays under the pointer until it is put down.
      if (this.dragging?.id !== token.id) drawn.group.position.set(token.x, token.y);
      this.draw(drawn);
    });
  }

  /** Tokens someone is dragging now: drawn where the GM has them, until the list takes over again. */
  live(places: readonly LivePlace[]): void {
    for (const place of places) {
      const drawn = this.drawn.get(place.id);
      if (drawn === undefined || this.dragging?.id === place.id) continue;
      if (place.end === true) drawn.group.position.set(drawn.token.x, drawn.token.y);
      else drawn.group.position.set(place.x, place.y);
    }
  }

  /** The GM did not take a move: the token goes back where the GM has it. */
  refused(id: string, x: number | null, y: number | null): void {
    const drawn = this.drawn.get(id);
    if (drawn === undefined) return;
    drawn.group.position.set(x ?? drawn.token.x, y ?? drawn.token.y);
  }

  private create(token: SharedToken): Drawn {
    const group = new Container();
    group.eventMode = 'static';
    group.on('pointerdown', (event: FederatedPointerEvent) => this.pick(token.id, event));
    this.layer.addChild(group);
    return { token, group, art: null, artHash: null };
  }

  private draw(drawn: Drawn): void {
    const { token, group } = drawn;
    group.angle = 0;
    if (drawn.art !== null) drawn.art.mask = null;
    for (const child of [...group.children]) if (child !== drawn.art) child.destroy();
    const radius = token.size / 2;
    // The shapes inside are passive: the group itself takes the pointer, over the token's disc.
    group.hitArea = new Circle(0, 0, Math.max(radius, (token.ring?.size ?? 0) / 2));
    if (token.art === null) {
      group.addChild(new Graphics().circle(0, 0, radius).fill({ color: 0x5b6270 }));
    } else if (drawn.artHash !== token.art.hash) {
      drawn.artHash = token.art.hash;
      const hash = token.art.hash;
      this.assets.image(token.art, TOKEN_ART_SIDE).then((image) => {
        if (drawn.artHash !== hash || group.destroyed) return;
        drawn.art?.destroy();
        const sprite = new Sprite(Texture.from(image.bitmap));
        sprite.anchor.set(0.5);
        drawn.art = sprite;
        group.addChild(sprite);
        this.draw(drawn);
      }).catch(() => undefined);
    }
    if (drawn.art !== null) {
      const art = drawn.art;
      const scale = token.size / Math.max(art.texture.width, art.texture.height);
      art.scale.set(scale);
      art.angle = token.rotation;
      if (token.ring !== null) {
        // A framed token shows its art as a disc inside the ring.
        const mask = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });
        group.addChild(mask);
        art.mask = mask;
      } else {
        art.mask = null;
      }
      group.setChildIndex(art, group.children.length - 1);
      // A downed creature is greyed out, under its skull.
      art.tint = token.ui?.downed === true ? 0x6b6b6b : 0xffffff;
    }
    if (token.ring !== null) group.addChild(ringOf(token.size, token.ring));
    const outer = token.ring?.size ?? token.size;
    let nameTop = outer / 2 + 4;
    if (token.ui !== null) {
      const own = this.mine.has(token.id) ? this.ownBars[token.id] : undefined;
      const ui = own === undefined ? token.ui : { ...token.ui, bars: own };
      nameTop = drawTokenUI(group, ui, token.size, outer).nameTop;
    }
    // A creature shows its name only where the GM's nameplate does; other tokens show the name they are sent.
    const showName = token.name !== null && token.name !== '' && (token.ui === null || token.ui.nameplate);
    if (showName) {
      const label = new Text({ text: token.name ?? '', style: { fontFamily: 'system-ui, sans-serif', fontSize: Math.max(10, radius * 0.35), fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 0);
      label.position.set(0, nameTop);
      group.addChild(label);
    }
    this.style(drawn);
  }

  private style(drawn: Drawn): void {
    const mine = this.mine.has(drawn.token.id);
    drawn.group.cursor = mine ? 'grab' : 'default';
  }

  private pick(id: string, event: FederatedPointerEvent): void {
    const drawn = this.drawn.get(id);
    if (drawn === undefined || !this.dragsEnabled || !this.mine.has(id) || this.scene === null || event.button !== 0) return;
    event.stopPropagation();
    const at = this.viewport.toWorld(event.global);
    this.dragging = { id, offsetX: drawn.group.x - at.x, offsetY: drawn.group.y - at.y, lastSent: 0 };
    this.viewport.plugins.pause('drag');
    drawn.group.cursor = 'grabbing';
  }

  private dragTo(event: FederatedPointerEvent): void {
    const held = this.dragging;
    if (held === null || this.scene === null) return;
    const drawn = this.drawn.get(held.id);
    if (drawn === undefined) return;
    const at = this.viewport.toWorld(event.global);
    drawn.group.position.set(at.x + held.offsetX, at.y + held.offsetY);
    const now = performance.now();
    if (now - held.lastSent < DRAG_INTERVAL_MS) return;
    held.lastSent = now;
    this.send({ t: 'drag', scene: this.scene, id: held.id, x: drawn.group.x, y: drawn.group.y });
  }

  private drop(): void {
    const held = this.dragging;
    if (held === null) return;
    this.dragging = null;
    this.viewport.plugins.resume('drag');
    const drawn = this.drawn.get(held.id);
    if (drawn === undefined || this.scene === null) return;
    drawn.group.cursor = 'grab';
    const moved = Math.hypot(drawn.group.x - drawn.token.x, drawn.group.y - drawn.token.y) > 1;
    if (moved) this.send({ t: 'move', scene: this.scene, id: held.id, x: drawn.group.x, y: drawn.group.y });
    else this.send({ t: 'drag-cancel', scene: this.scene, id: held.id });
  }
}

/**
 * The ring around a framed token, over its art as the GM's map draws it (`SpriteFactory.createTokenRing`):
 * the ring's artwork tinted with its colour, or a plain ring of that colour until the artwork has loaded.
 */
function ringOf(tokenSize: number, ring: NonNullable<SharedToken['ring']>): Sprite | Graphics {
  const colour = Number.parseInt(ring.colour.slice(1), 16);
  const texture = loadedTokenRingTexture();
  if (texture === null) {
    const width = Math.max(2, (ring.size - tokenSize) / 2);
    return new Graphics().circle(0, 0, ring.size / 2 - width / 2).stroke({ width, color: colour, alpha: 0.95 });
  }
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.width = ring.size;
  sprite.height = ring.size;
  sprite.tint = colour;
  return sprite;
}
