import type { ImageMessage } from '../../../src/app/online/protocol/image.ts';
import type { ShownImageRef } from '../../../src/app/online/protocol/logShown.ts';
import type { AssetLoader } from './assets.ts';

/** A shown image is asked for at most this large: it fills a screen, not a map. */
const IMAGE_SIDE = 4096;

/**
 * An image over the map: the one the GM shows everyone, or one opened from the log. The player may
 * close it; the same showing does not come back, a new one does. It is a modal layer
 * (`aria-modal`), so the log panel leaves its presses and Escape to it.
 */
export class ImageViewer {
  private readonly host: HTMLElement;
  private readonly assets: AssetLoader;
  private layer: HTMLElement | null = null;
  private showing: string | null = null;
  private readonly closed = new Set<string>();

  constructor(host: HTMLElement, assets: AssetLoader) {
    this.host = host;
    this.assets = assets;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.layer !== null) this.close();
    });
  }

  fromGm(message: ImageMessage): void {
    if (message.shown === null) {
      if (this.showing !== null) this.close();
      return;
    }
    if (this.closed.has(message.shown.id)) return;
    this.open(message.shown, message.shown.id);
  }

  open(image: ShownImageRef, showing: string | null = null): void {
    this.remove();
    this.showing = showing;
    const layer = document.createElement('div');
    layer.className = 'viewer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'Image montrée par le MJ');
    const picture = document.createElement('img');
    picture.className = 'viewer-image';
    picture.alt = '';
    picture.width = image.width;
    picture.height = image.height;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'viewer-close';
    close.textContent = 'Fermer';
    close.addEventListener('click', () => this.close());
    layer.addEventListener('click', (event) => {
      if (event.target === layer) this.close();
    });
    layer.append(picture, close);
    this.host.append(layer);
    this.layer = layer;
    this.assets.image(image.image, IMAGE_SIDE).then((loaded) => {
      if (this.layer === layer) picture.src = loaded.url;
    }).catch(() => {
      if (this.layer === layer) picture.replaceWith(Object.assign(document.createElement('p'), { textContent: 'L\'image n\'a pas pu être chargée.' }));
    });
  }

  private close(): void {
    if (this.showing !== null) this.closed.add(this.showing);
    this.remove();
  }

  private remove(): void {
    this.layer?.remove();
    this.layer = null;
    this.showing = null;
  }
}
