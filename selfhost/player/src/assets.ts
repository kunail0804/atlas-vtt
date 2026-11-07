import { MAX_STORED_BYTES, type AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { GmMessage } from '../../../src/app/online/protocol/game.ts';
import { readQuestText } from '../../../src/app/online/protocol/questText.ts';
import type { AssetCache } from './assetCache.ts';

/** An image ready to draw: `width` × `height` is the size to draw it at (an image shrunk for this device is drawn at its own size). */
export interface LoadedImage {
  readonly bitmap: ImageBitmap;
  /** The same image as an object URL, for elements (`<img>`): the page's policy allows blob: images. */
  readonly url: string;
  /** The checked bytes, for readers that want them as they came (the explored memory's PNG). */
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** `persist`: whether the asset is kept in the browser between visits. Off for what stands for the table's state (the explored memory). */
export interface ImageOptions {
  readonly persist?: boolean;
}

/** Where the relay serves a stored object to players: the page's own origin (`assetStore.ts` in the relay). */
export const assetUrl = (id: string): string => `/api/assets/${id}`;

/** How long a fetch the store answered without the object waits before it asks again, should no progress say it is there. */
const RETRY_MS = 5_000;
/** How many times an object the store does not hold is asked for before it is given up (ten minutes). */
const MAX_TRIES = 120;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Assets as the GM's Atlas stores them for players: each is fetched from the relay by its id once the
 * GM's progress says it is there (`asset-progress`), and kept only when its SHA-256 is the hash its
 * reference names. An image larger than the longest side asked for is shrunk here, and drawn at its
 * own size. What the browser kept from an earlier visit (`AssetCache`) is taken from there.
 */
export class AssetLoader {
  private readonly cache: AssetCache;
  private readonly loaded = new Map<string, Promise<LoadedImage>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly blobs = new Map<string, Promise<Blob>>();
  /** The ids the GM said can be fetched now. */
  private readonly ready = new Set<string>();
  /** Fetches waiting for their id to be ready, by id. */
  private readonly waiting = new Map<string, (() => void)[]>();

  constructor(cache: AssetCache, private readonly fetchAsset: (url: string) => Promise<Response> = (url) => fetch(url, { credentials: 'omit' })) {
    this.cache = cache;
  }

  image(ref: AssetRef, maxSide: number | null, options: ImageOptions = {}): Promise<LoadedImage> {
    const key = `${ref.hash}@${maxSide ?? 'full'}`;
    const known = this.loaded.get(key);
    if (known !== undefined) return known;
    const promise = this.blob(ref, options.persist ?? true).then(async (blob) => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        throw new Error('The image could not be decoded.');
      }
      const width = bitmap.width;
      const height = bitmap.height;
      const fit = maxSide === null ? 1 : maxSide / Math.max(width, height);
      if (fit < 1) {
        // A phone holds the decoded image: a large map is kept at the side asked for, and drawn at its own size.
        const shrunk = await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(width * fit)), resizeHeight: Math.max(1, Math.round(height * fit)), resizeQuality: 'high' });
        bitmap.close();
        bitmap = shrunk;
      }
      return { bitmap, url: URL.createObjectURL(blob), blob, width, height };
    });
    // A failed image is forgotten, so the next scene or token showing it asks again.
    promise.catch(() => this.loaded.delete(key));
    this.loaded.set(key, promise);
    return promise;
  }

  /** A text asset (a quest's Markdown), read as the plugin reads it: strict UTF-8, within the asset limit. */
  text(ref: AssetRef): Promise<string> {
    const known = this.texts.get(ref.hash);
    if (known !== undefined) return known;
    const promise = this.blob(ref, true).then(async (blob) => {
      const text = readQuestText(new Uint8Array(await blob.arrayBuffer()));
      if (text === null) throw new Error('unreadable text');
      return text;
    });
    promise.catch(() => this.texts.delete(ref.hash));
    this.texts.set(ref.hash, promise);
    return promise;
  }

  /** Takes the GM's upload progress; false for any other message. */
  receive(message: GmMessage): boolean {
    if (message.t !== 'asset-progress') return false;
    for (const [id, share] of Object.entries(message.shares)) {
      if (share < 1) continue;
      this.ready.add(id);
      const waiters = this.waiting.get(id);
      this.waiting.delete(id);
      for (const wake of waiters ?? []) wake();
    }
    return true;
  }

  /** The checked bytes of `ref`, from the browser's cache or the relay; one fetch per hash at a time. */
  private blob(ref: AssetRef, persist: boolean): Promise<Blob> {
    const known = this.blobs.get(ref.hash);
    if (known !== undefined) return known;
    const promise = this.load(ref, persist);
    // Kept while it runs and after it, so the same bytes are fetched once; a failure is tried again later.
    promise.catch(() => this.blobs.delete(ref.hash));
    this.blobs.set(ref.hash, promise);
    return promise;
  }

  private async load(ref: AssetRef, persist: boolean): Promise<Blob> {
    if (ref.tiles === true) throw new Error('This relay serves no tile pyramids.');
    if (ref.size > MAX_STORED_BYTES) throw new Error('The asset is larger than any the store holds.');
    if (persist) {
      const cached = await this.cache.get(ref.hash);
      if (cached !== null && cached.hash === ref.hash) return cached.blob;
    }
    const bytes = await this.fetchStored(ref.id);
    if (bytes.length !== ref.size) throw new Error('The asset arrived with the wrong size.');
    if ((await sha256Hex(bytes)) !== ref.hash) throw new Error('The asset arrived damaged.');
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ref.mime });
    if (persist) void this.cache.put(ref.hash, { blob, hash: ref.hash, drawSize: null });
    return blob;
  }

  /** The stored object's bytes: asked for at once, and again whenever the GM says it is there, or every `RETRY_MS` meanwhile, `MAX_TRIES` times at most. */
  private async fetchStored(id: string): Promise<Uint8Array> {
    for (let tries = 0; tries < MAX_TRIES; tries += 1) {
      const response = await this.fetchAsset(assetUrl(id)).catch(() => null);
      if (response?.ok === true) return new Uint8Array(await response.arrayBuffer());
      if (response !== null && response.status !== 404) throw new Error(`The relay answered ${response.status}.`);
      this.ready.delete(id);
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, RETRY_MS);
        const list = this.waiting.get(id) ?? [];
        list.push(() => {
          window.clearTimeout(timer);
          resolve();
        });
        this.waiting.set(id, list);
      });
    }
    throw new Error('The relay never held this asset.');
  }
}
