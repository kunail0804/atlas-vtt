/**
 * Assets the page already downloaded, kept in the browser between visits: images and quest texts,
 * which are named by the SHA-256 of their bytes and so never change under their name. Nothing of the
 * table's state goes here (positions, fog, explored memory, books, sheets): those change, and the GM
 * sends them on every visit.
 */

/** Bytes the cache keeps at most; less where the browser grants this origin little room. */
export const CACHE_BUDGET_BYTES = 200 * 1024 * 1024;
/** Share of the origin's quota the cache takes at most. */
const QUOTA_SHARE = 0.1;
/** Entries the cache keeps at most, so its index stays small in `localStorage`. */
export const MAX_ENTRIES = 2000;
/** An asset larger than this share of the budget is not kept: it would push out everything else. */
const LARGEST_SHARE = 0.25;
/** How long after a change the index is written, so a scene of fifty tokens writes it once. */
const SAVE_DELAY_MS = 1000;

const CACHE_NAME = 'atlas-vtt-assets-v1';
const INDEX_KEY = 'atlas-vtt:asset-cache-v1';
/** Where entries live in the cache's own namespace. No request is ever sent there. */
const URL_PREFIX = '/__atlas-asset-cache/';

/** An asset as the cache keeps it: its bytes, their SHA-256, and the size to draw a scaled copy at. */
export interface CachedAsset {
  readonly blob: Blob;
  readonly hash: string;
  readonly drawSize: { readonly width: number; readonly height: number } | null;
}

/** The cache's limits: `CACHE_BUDGET_BYTES` and `MAX_ENTRIES` unless named. */
export interface AssetCacheLimits {
  readonly budgetBytes?: number;
  readonly maxEntries?: number;
}

interface IndexEntry {
  readonly key: string;
  readonly bytes: number;
  usedAt: number;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry: Record<string, unknown> = { ...value };
  return typeof entry.key === 'string' && typeof entry.bytes === 'number' && typeof entry.usedAt === 'number';
}

function readIndex(): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  let stored: unknown;
  try {
    stored = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]');
  } catch {
    return index;
  }
  if (!Array.isArray(stored)) return index;
  for (const entry of stored) if (isIndexEntry(entry)) index.set(entry.key, { key: entry.key, bytes: entry.bytes, usedAt: entry.usedAt });
  return index;
}

function drawSizeOf(response: Response): CachedAsset['drawSize'] {
  const width = Number(response.headers.get('x-draw-width'));
  const height = Number(response.headers.get('x-draw-height'));
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The browser's Cache Storage under a byte budget, least recently used out first. Every read checks
 * the bytes against the SHA-256 they were stored with, so a damaged entry is dropped, never shown.
 * Where the browser has no Cache Storage or refuses it (a private window), every read misses and
 * every write is dropped: the page then downloads as it did without a cache.
 */
export class AssetCache {
  /** The cache, once entries the index does not name are gone; null where there is none. */
  private readonly cache: Promise<Cache | null>;
  private readonly budget: Promise<number>;
  private readonly maxEntries: number;
  private readonly index: Map<string, IndexEntry>;
  private saveTimer: number | undefined;

  constructor(limits: AssetCacheLimits = {}) {
    const budget = limits.budgetBytes ?? CACHE_BUDGET_BYTES;
    this.maxEntries = limits.maxEntries ?? MAX_ENTRIES;
    this.index = readIndex();
    const opened = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE_NAME).catch(() => null);
    // Reads and writes wait for the clean-up, or it could drop an entry written meanwhile.
    this.cache = opened.then(async (cache) => {
      if (cache !== null) await this.forgetUnindexed(cache);
      return cache;
    });
    this.budget = navigator.storage?.estimate === undefined
      ? Promise.resolve(budget)
      : navigator.storage.estimate().then(({ quota }) => (quota === undefined ? budget : Math.min(budget, quota * QUOTA_SHARE))).catch(() => budget);
  }

  async get(key: string): Promise<CachedAsset | null> {
    const cache = await this.cache;
    if (cache === null) return null;
    try {
      const response = await cache.match(URL_PREFIX + key);
      if (response === undefined) return null;
      const hash = response.headers.get('x-hash') ?? '';
      const bytes = await response.arrayBuffer();
      if ((await sha256Hex(bytes)) !== hash) {
        await this.remove(cache, key);
        return null;
      }
      this.index.set(key, { key, bytes: bytes.byteLength, usedAt: Date.now() });
      this.scheduleSave();
      const type = response.headers.get('content-type') ?? '';
      return { blob: new Blob([bytes], { type }), hash, drawSize: drawSizeOf(response) };
    } catch {
      return null;
    }
  }

  async put(key: string, asset: CachedAsset): Promise<void> {
    const cache = await this.cache;
    if (cache === null) return;
    const budget = await this.budget;
    if (asset.blob.size > budget * LARGEST_SHARE) return;
    const headers: Record<string, string> = { 'content-type': asset.blob.type, 'x-hash': asset.hash };
    if (asset.drawSize !== null) {
      headers['x-draw-width'] = String(asset.drawSize.width);
      headers['x-draw-height'] = String(asset.drawSize.height);
    }
    try {
      await this.evict(cache, budget - asset.blob.size, this.maxEntries - 1);
      await cache.put(URL_PREFIX + key, new Response(asset.blob, { headers }));
      this.index.set(key, { key, bytes: asset.blob.size, usedAt: Date.now() });
      this.scheduleSave();
    } catch {
      // A full disk or a refused write leaves the asset uncached: the page still has it in memory.
    }
  }

  /** Drops the least recently used entries until at most `bytes` and `entries` remain. */
  private async evict(cache: Cache, bytes: number, entries: number): Promise<void> {
    let total = 0;
    for (const entry of this.index.values()) total += entry.bytes;
    const oldestFirst = [...this.index.values()].sort((a, b) => a.usedAt - b.usedAt);
    let count = oldestFirst.length;
    for (const entry of oldestFirst) {
      if (total <= bytes && count <= entries) break;
      await this.remove(cache, entry.key);
      total -= entry.bytes;
      count -= 1;
    }
  }

  private async remove(cache: Cache, key: string): Promise<void> {
    this.index.delete(key);
    this.scheduleSave();
    await cache.delete(URL_PREFIX + key).catch(() => false);
  }

  /**
   * Entries the index does not name (another tab of the same table wrote the index after this one)
   * would escape the budget: they are dropped when the page starts.
   */
  private async forgetUnindexed(cache: Cache): Promise<void> {
    try {
      for (const request of await cache.keys()) {
        const key = new URL(request.url).pathname.slice(URL_PREFIX.length);
        if (!this.index.has(key)) await cache.delete(request);
      }
    } catch {
      // The next start tries again.
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = undefined;
      try {
        window.localStorage.setItem(INDEX_KEY, JSON.stringify([...this.index.values()]));
      } catch {
        // A full localStorage keeps the index in memory only until the page closes.
      }
    }, SAVE_DELAY_MS);
  }
}
