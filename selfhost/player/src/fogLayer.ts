import { Container, Sprite, Texture } from 'pixi.js';
import type { SharedFog } from '../../../src/app/online/protocol/fog.ts';
import { FogCanvasCompositor } from '../../../src/app/pixi/fog/FogCanvasCompositor.ts';
import type { FogOperation } from '../../../src/app/types/fogTypes.ts';

/** The fog operations as the plugin's compositor takes them: the inverse of `sharedOperation` in sceneInputs.ts. */
function operations(fog: Exclude<SharedFog, null>): Record<string, FogOperation> {
  const result: Record<string, FogOperation> = {};
  fog.forEach((shared, index) => {
    // The order players get is the order to replay: it becomes the timestamp the compositor sorts by.
    const base = { id: shared.id ?? String(index), kind: 'fog' as const, timestamp: index, isErasing: shared.erase };
    if (shared.type === 'rectangle') {
      result[base.id] = { ...base, type: 'rectangle', x: shared.x, y: shared.y, width: shared.width, height: shared.height };
      return;
    }
    const points: { x: number; y: number }[] = [];
    for (let at = 0; at + 1 < shared.points.length; at += 2) points.push({ x: shared.points[at] ?? 0, y: shared.points[at + 1] ?? 0 });
    result[base.id] = shared.type === 'brush' ? { ...base, type: 'brush', points, brushRadius: shared.radius } : { ...base, type: 'lasso', points };
  });
  return result;
}

/** The committed fog over the map, solid for players, drawn with the plugin's own compositor. */
export class FogLayer {
  private readonly layer: Container;
  private compositor: FogCanvasCompositor | null = null;
  private sprite: Sprite | null = null;

  constructor(layer: Container) {
    this.layer = layer;
  }

  /** Draws `fog` over a map of `width` × `height`; null fog (unreadable) covers the whole map. */
  show(fog: SharedFog, width: number, height: number): void {
    const bounds = { x: 0, y: 0, width, height };
    if (this.compositor === null) this.compositor = new FogCanvasCompositor(bounds);
    else this.compositor.updateBounds(bounds);
    const compositor = this.compositor;
    compositor.reset();
    if (fog === null) {
      const context = compositor.getCanvas().getContext('2d');
      if (context !== null) {
        context.fillStyle = '#000';
        context.fillRect(0, 0, compositor.getCanvas().width, compositor.getCanvas().height);
      }
    } else {
      compositor.composite(operations(fog));
    }
    this.sprite?.destroy({ texture: true, textureSource: true });
    const sprite = new Sprite(Texture.from(compositor.getCanvas(), true));
    sprite.width = width;
    sprite.height = height;
    this.layer.addChild(sprite);
    this.sprite = sprite;
  }

  clear(): void {
    this.sprite?.destroy({ texture: true, textureSource: true });
    this.sprite = null;
    this.compositor?.reset();
  }
}
