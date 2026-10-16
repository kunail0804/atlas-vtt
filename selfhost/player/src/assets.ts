import { MAX_ASSET_BYTES, isMaxSide, type AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { readQuestText } from '../../../src/app/online/protocol/questText.ts';

/** An image ready to draw: `width` × `height` is the size to draw it at (a scaled copy is drawn at its original's size). */
export interface LoadedImage {
  readonly bitmap: ImageBitmap;
  /** The same image as an object URL, for elements (`<img>`): the page's policy allows blob: images. */
  readonly url: string;
  /** The checked bytes, for readers that want them as they came (the explored memory's PNG). */
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** An asset's checked bytes, and the size to draw a scaled copy at (null for the asset itself). */
interface Fetched {
  readonly blob: Blob;
  readonly drawSize: { width: number; height: number } | null;
}

/** A download that hears nothing for this long asks again, from the first chunk it lacks. */
const STALL_MS = 15_000;

interface Download {
  readonly mime: string;
  readonly size: number;
  readonly chunks: (Uint8Array | undefined)[];
  received: number;
  count: number | null;
  /** The request this download answers; the GM continues a download `from` a chunk. */
  readonly request: { readonly hash: string; readonly maxSide: number | null };
  drawSize: { width: number; height: number } | null;
  readonly waiters: { resolve: (fetched: Fetched) => void; reject: (reason: Error) => void }[];
  stall: number | undefined;
}

function base64Bytes(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Images by hash, as the GM serves them: the page asks once, the chunks come back, and the bytes are
 * kept only when their SHA-256 is the hash asked for. An image larger than the asked longest side
 * comes as a scaled copy under its own hash (`asset-variant`), drawn at the original's size.
 */
export class AssetLoader {
  private readonly send: (message: PlayerMessage) => void;
  /** Downloads by the hash their chunks carry: the asset's own, or its scaled copy's. */
  private readonly downloads = new Map<string, Download>();
  private readonly loaded = new Map<string, Promise<LoadedImage>>();
  private readonly texts = new Map<string, Promise<string>>();

  constructor(send: (message: PlayerMessage) => void) {
    this.send = send;
  }

  image(ref: AssetRef, maxSide: number | null): Promise<LoadedImage> {
    const side = maxSide !== null && isMaxSide(maxSide) ? maxSide : null;
    const cacheKey = `${ref.hash}@${side ?? 'full'}`;
    const known = this.loaded.get(cacheKey);
    if (known !== undefined) return known;
    const promise = this.fetch(ref, side).then(async ({ blob, drawSize }) => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        throw new Error('The image could not be decoded.');
      }
      const size = drawSize ?? { width: bitmap.width, height: bitmap.height };
      return { bitmap, url: URL.createObjectURL(blob), blob, width: size.width, height: size.height };
    });
    // A failed image is forgotten, so the next scene or token showing it asks again.
    promise.catch(() => this.loaded.delete(cacheKey));
    this.loaded.set(cacheKey, promise);
    return promise;
  }

  /** A text asset (a quest's Markdown), read as the plugin reads it: strict UTF-8, within the asset limit. */
  text(ref: AssetRef): Promise<string> {
    const known = this.texts.get(ref.hash);
    if (known !== undefined) return known;
    const promise = this.fetch(ref, null).then(async ({ blob }) => {
      const text = readQuestText(new Uint8Array(await blob.arrayBuffer()));
      if (text === null) throw new Error('unreadable text');
      return text;
    });
    promise.catch(() => this.texts.delete(ref.hash));
    this.texts.set(ref.hash, promise);
    return promise;
  }

  private fetch(ref: AssetRef, maxSide: number | null): Promise<Fetched> {
    return new Promise<Fetched>((resolve, reject) => {
      const download: Download = {
        mime: ref.mime, size: ref.size, chunks: [], received: 0, count: null,
        request: { hash: ref.hash, maxSide }, drawSize: null, waiters: [{ resolve, reject }], stall: undefined,
      };
      this.downloads.set(ref.hash, download);
      this.ask(download, 0);
    });
  }

  /** Takes the asset messages; false for any other message. */
  receive(message: GmMessage): boolean {
    if (message.t === 'asset-variant') {
      const original = this.downloads.get(message.hash);
      if (original === undefined || original.received > 0) return true;
      this.downloads.delete(message.hash);
      const copy: Download = { ...original, mime: message.variant.mime, size: message.variant.size, chunks: [], drawSize: { width: message.width, height: message.height } };
      this.downloads.set(message.variant.hash, copy);
      return true;
    }
    if (message.t === 'asset-refused') {
      const download = this.downloads.get(message.hash);
      if (download !== undefined) this.fail(message.hash, download, new Error('The GM did not send this image.'));
      return true;
    }
    if (message.t !== 'asset-chunk') return false;
    const download = this.downloads.get(message.hash);
    if (download === undefined || message.index >= message.count) return true;
    if (download.count === null) download.count = message.count;
    if (download.count !== message.count || download.chunks[message.index] !== undefined) return true;
    download.chunks[message.index] = base64Bytes(message.data);
    download.received += 1;
    this.watch(download);
    if (download.received === download.count) void this.finish(message.hash, download);
    return true;
  }

  private ask(download: Download, from: number): void {
    const { hash, maxSide } = download.request;
    this.send({ t: 'asset-request', hash, ...(from > 0 ? { from } : {}), ...(maxSide === null ? {} : { maxSide }) });
    this.watch(download);
  }

  private watch(download: Download): void {
    window.clearTimeout(download.stall);
    download.stall = window.setTimeout(() => {
      const missing = download.chunks.findIndex((chunk) => chunk === undefined);
      this.ask(download, download.count === null ? 0 : missing === -1 ? download.chunks.length : missing);
    }, STALL_MS);
  }

  private async finish(hash: string, download: Download): Promise<void> {
    window.clearTimeout(download.stall);
    this.downloads.delete(hash);
    const total = download.chunks.reduce((sum, chunk) => sum + (chunk?.length ?? 0), 0);
    if (total !== download.size || total > MAX_ASSET_BYTES) return this.fail(hash, download, new Error('The asset arrived with the wrong size.'));
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of download.chunks) {
      if (chunk === undefined) continue;
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if ((await sha256Hex(bytes)) !== hash) return this.fail(hash, download, new Error('The asset arrived damaged.'));
    const blob = new Blob([bytes], { type: download.mime });
    for (const waiter of download.waiters) waiter.resolve({ blob, drawSize: download.drawSize });
  }

  private fail(hash: string, download: Download, reason: Error): void {
    window.clearTimeout(download.stall);
    this.downloads.delete(hash);
    for (const waiter of download.waiters) waiter.reject(reason);
  }
}
