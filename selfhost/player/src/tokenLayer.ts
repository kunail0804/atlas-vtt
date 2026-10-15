import { Circle, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { LivePlace } from '../../../src/app/online/protocol/live.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import type { AssetLoader } from './assets.ts';

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
  private scene: string | null = null;
  private dragging: { id: string; offsetX: number; offsetY: number; lastSent: number } | null = null;

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
  }

  /** A new scene: every token goes. */
  reset(scene: string | null): void {
    this.scene = scene;
    this.mine = new Set();
    this.dragging = null;
    this.viewport.plugins.resume('drag');
    for (const drawn of this.drawn.values()) drawn.group.destroy({ children: true });
    this.drawn.clear();
  }

  setMine(ids: readonly string[]): void {
    this.mine = new Set(ids);
    for (const drawn of this.drawn.values()) this.style(drawn);
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
    if (token.ring !== null) {
      const ring = new Graphics().circle(0, 0, token.ring.size / 2).fill({ color: token.ring.colour });
      group.addChildAt(ring, 0);
    }
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
    }
    if (token.name !== null && token.name !== '') {
      const label = new Text({ text: token.name, style: { fontFamily: 'system-ui, sans-serif', fontSize: Math.max(10, radius * 0.35), fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 0);
      label.position.set(0, (token.ring?.size ?? token.size) / 2 + 4);
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
    if (drawn === undefined || !this.mine.has(id) || this.scene === null || event.button !== 0) return;
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
