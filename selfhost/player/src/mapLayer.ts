import { Container, Sprite, Texture } from 'pixi.js';
import type { MapImageChange, MapImageView } from '../../../src/app/pixi/mapImage/mapImageView.ts';
import type { PixelRect } from '../../../src/app/pixi/mapImage/pyramid.ts';
import type { LoadedImage } from './assets.ts';

/**
 * The shared map image, drawn at its natural size at (0, 0) as the GM's map is. It is also what the
 * plugin's grid needs to know of a map (`MapImageView`): its rect, its layer, and its pixels for the
 * automatic line colour.
 */
export class MapLayer implements MapImageView {
  readonly layer: Container;
  private sprite: Sprite | null = null;
  private image: LoadedImage | null = null;
  private readonly listeners = new Set<(change: MapImageChange) => void>();

  constructor(layer: Container) {
    this.layer = layer;
  }

  get worldRect(): PixelRect | null {
    return this.image === null ? null : { x: 0, y: 0, width: this.image.width, height: this.image.height };
  }

  get imageSize(): { width: number; height: number } | null {
    return this.image === null ? null : { width: this.image.bitmap.width, height: this.image.bitmap.height };
  }

  show(image: LoadedImage | null): void {
    this.sprite?.destroy({ texture: true, textureSource: true });
    this.sprite = null;
    this.image = image;
    if (image !== null) {
      const sprite = new Sprite(Texture.from(image.bitmap));
      sprite.width = image.width;
      sprite.height = image.height;
      this.layer.addChild(sprite);
      this.sprite = sprite;
    }
    for (const listener of this.listeners) listener('image');
  }

  async overview(maxSide: number): Promise<ImageBitmap | null> {
    if (this.image === null) return null;
    const { bitmap } = this.image;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    return createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(bitmap.width * scale)), resizeHeight: Math.max(1, Math.round(bitmap.height * scale)) });
  }

  onChange(listener: (change: MapImageChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
