import type { AssetLoader } from './assets.ts';
import { button, node } from './bookDom.ts';
import { readableText, type Readable } from './documentView.ts';
import { TEXT } from './text.ts';

/** A note a found pin let the players read, over the map until it is closed. */
export class Reader {
  private readonly host: HTMLElement;
  private readonly assets: AssetLoader;
  private shown: HTMLElement | null = null;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
  };

  constructor(host: HTMLElement, assets: AssetLoader) {
    this.host = host;
    this.assets = assets;
  }

  open(note: Readable & { readonly title: string }): void {
    this.close();
    const overlay = node('div', 'reader');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const panel = node('article', 'reader-panel');
    const close = button(TEXT.reader.close, () => this.close(), 'reader-close');
    panel.append(close, node('h2', 'reader-title', note.title), readableText(this.assets, note));
    overlay.append(panel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    this.host.append(overlay);
    window.addEventListener('keydown', this.onKey);
    this.shown = overlay;
    close.focus();
  }

  close(): void {
    this.shown?.remove();
    this.shown = null;
    window.removeEventListener('keydown', this.onKey);
  }
}
