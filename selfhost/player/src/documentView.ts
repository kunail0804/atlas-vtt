import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import { questTextParts, type QuestEmbed, type QuestImage } from '../../../src/app/online/protocol/questText.ts';
import type { AssetLoader } from './assets.ts';
import { assetImage, node } from './bookDom.ts';

/** The largest side an image in a text is asked for at. */
const TEXT_IMAGE_SIDE = 1600;

/** A text the GM lets players read: a quest, a found pin's note. `body` is its opening; `text` the whole, by hash. */
export interface Readable {
  readonly body: string;
  readonly text?: AssetRef;
  readonly images?: readonly QuestImage[];
}

const sameEmbed = (a: QuestEmbed, b: QuestEmbed): boolean => a.target === b.target && a.width === b.width && a.height === b.height;

/** The text with its images where it embeds them: an embed the GM named an image for is drawn, any other stays as written. */
function fill(element: HTMLElement, assets: AssetLoader, text: string, images: readonly QuestImage[]): void {
  element.replaceChildren(...questTextParts(text).map((part) => {
    if ('text' in part) return document.createTextNode(part.text);
    const image = images.find((candidate) => sameEmbed(candidate, part.embed));
    if (image === undefined) return document.createTextNode(part.written);
    const shown = assetImage(assets, image.image, TEXT_IMAGE_SIDE, 'doc-image');
    if (part.embed.width !== null) shown.style.width = `${part.embed.width}px`;
    return shown;
  }));
}

/** A readable text: its opening at once, the whole once it is here. Never markup: text nodes and images only. */
export function readableText(assets: AssetLoader, readable: Readable): HTMLElement {
  const element = node('div', 'doc-text');
  const images = readable.images ?? [];
  fill(element, assets, readable.body, images);
  if (readable.text !== undefined) assets.text(readable.text).then((text) => fill(element, assets, text, images)).catch(() => undefined);
  return element;
}
