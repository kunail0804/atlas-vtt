import { Container, Sprite, Texture } from 'pixi.js';
import type { MosaicCanvasChange, MosaicCanvasView } from '../../../src/app/pixi/mosaicCanvas/mosaicCanvasView.ts';
import type { PixelRect } from '../../../src/app/pixi/mosaicCanvas/pyramid.ts';
import type { LoadedImage } from './assets.ts';

/**
 * The shared map image, drawn at its natural size at (0, 0) as the GM's map is. It is also what the
 * plugin's grid needs to know of a map (`MosaicCanvasView`): its rect, its layer, and its pixels for
 * the automatic line colour.
 */
export class MapLayer implements MosaicCanvasView {
  readonly layer: Container;
  private sprite: Sprite | null = null;
  private image: LoadedImage | null = null;
  private readonly listeners = new Set<(change: MosaicCanvasChange) => void>();

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

  /** `rect` of the image's own pixels fit within `maxSide`; null without an image or for a rect outside it. */
  async window(rect: PixelRect, maxSide: number): Promise<ImageBitmap | null> {
    if (this.image === null) return null;
    const { bitmap } = this.image;
    // The bitmap may be shrunk for this device: the rect is read from it at its scale.
    const ratio = bitmap.width / this.image.width;
    const x = Math.max(0, Math.floor(rect.x * ratio));
    const y = Math.max(0, Math.floor(rect.y * ratio));
    const width = Math.min(bitmap.width - x, Math.ceil(rect.width * ratio));
    const height = Math.min(bitmap.height - y, Math.ceil(rect.height * ratio));
    if (width <= 0 || height <= 0) return null;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return createImageBitmap(bitmap, x, y, width, height, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) });
  }

  onChange(listener: (change: MosaicCanvasChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
