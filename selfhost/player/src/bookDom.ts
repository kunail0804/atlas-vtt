import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { AssetLoader } from './assets.ts';

/** An element with its class and, where given, its text (always as text, never as markup). */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function button(label: string, act: () => void, className = 'book-button'): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', act);
  return element;
}

/** 96 random bits in hex: the ids a player's page makes for its notes, pins and slots. */
export const randomId = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Binds a field to a draft kept outside the page's elements, so a redraw (a message from the GM, an
 * image arriving) keeps what the player is typing; `field` names it for the focus to come back.
 */
export function bound<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(drafts: Map<string, string>, key: string, element: T, initial: string): T {
  element.value = drafts.get(key) ?? initial;
  element.dataset.field = key;
  element.addEventListener('input', () => drafts.set(key, element.value));
  return element;
}

/** An image asked for by hash: a placeholder of its class until it is here. */
export function assetImage(assets: AssetLoader, ref: AssetRef, side: number, className: string): HTMLImageElement {
  const element = node('img', `${className} book-placeholder`);
  element.alt = '';
  assets.image(ref, side).then((loaded) => {
    element.src = loaded.url;
    element.classList.remove('book-placeholder');
  }).catch(() => undefined);
  return element;
}

/** One of the plugin's game-icons.net glyphs (512 units square), drawn in the text's colour. */
export function glyph(path: string, className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.append(shape);
  return svg;
}
