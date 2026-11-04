import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ASSET_CAPS, isAssetId, isAssetKind, type AssetKind } from '../../src/app/online/protocol/asset.ts';
import { sendJson } from './respond.ts';

// The plugin's asset store (`src/app/online/gm/assets/`) on the relay: the GM's Atlas offers what players
// are shown, uploads it on the GM side (loopback, with the GM's token), and players fetch it from the
// public side by its id. An id is HMAC-SHA-256(salt, content hash), so it is the capability to read an
// object and names it for good. Tile pyramids are refused (`kind`): the GM's Atlas then sends maps as images.

/** The salt's length, as the plugin reads it (`SALT_BYTES`). */
const SALT_BYTES = 32;
/** What all stored objects may hold together; the least recently used go first to make room. */
export const STORE_LIMIT = 6 * 1024 ** 3;
/** Objects up to this size go up in one body; larger ones in parts. */
export const SINGLE_MAX = 64 * 1024 * 1024;
/** The size of a part, as the plugin cuts them (`PART_BYTES` in `assetRoutes.ts`). */
export const PART_BYTES = 16 * 1024 * 1024;
/** The most assets one offer names, and the most bytes of JSON an offer or a part list may take. */
const MAX_OFFERED = 512;
const MAX_JSON_BYTES = 1024 * 1024;
/** How long an offer waits for its upload before it is forgotten. */
const OFFER_TTL_MS = 6 * 60 * 60 * 1000;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ROUTE = /^\/api\/assets\/([0-9a-f]{64})(?:\/(parts|complete|tiles)(?:\/(\d{1,4}))?)?$/;

interface Meta {
  readonly mime: string;
  readonly size: number;
  readonly kind: AssetKind;
}

interface Offered {
  readonly kind: AssetKind;
  readonly size: number;
  readonly at: number;
}

interface PartsSession {
  readonly uploadId: string;
  readonly size: number;
  readonly mime: string;
  readonly parts: readonly { readonly sha256: string; readonly size: number }[];
}

export interface AssetStore {
  /** Answers the store's routes on the GM side; false when the path is none of them. */
  handleGm(request: IncomingMessage, response: ServerResponse, pathname: string, isHost: boolean): boolean;
  /** Serves a stored object to a player on the public side; false when the path is no asset's. */
  serve(request: IncomingMessage, response: ServerResponse, pathname: string): boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSize = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
/** A media type as a header names it, without its parameters; empty for none. */
const mimeOf = (value: string | undefined): string => (value ?? '').split(';')[0]!.trim().toLowerCase();
const isMime = (value: string): boolean => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value) && value.length <= 100;

function loadSalt(dir: string): Buffer {
  const file = path.join(dir, 'asset-salt');
  try {
    const saved = readFileSync(file);
    if (saved.length === SALT_BYTES) return saved;
  } catch {
    // No salt yet: one is made below.
  }
  const salt = randomBytes(SALT_BYTES);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, salt, { mode: 0o600 });
  return salt;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += (chunk as Buffer).length;
    if (length > MAX_JSON_BYTES) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Writes a request's body to `file`, at most `size` bytes and exactly that many; the SHA-256 of what came, or null where it was not `size` bytes. */
async function receive(request: IncomingMessage, file: string, size: number): Promise<string | null> {
  const hash = createHash('sha256');
  let length = 0;
  const out = createWriteStream(file, { mode: 0o600 });
  try {
    await pipeline(request, async function* (source) {
      for await (const chunk of source) {
        length += (chunk as Buffer).length;
        if (length > size) throw new Error('too large');
        hash.update(chunk as Buffer);
        yield chunk;
      }
    }, out);
  } catch {
    await rm(file, { force: true });
    return null;
  }
  if (length !== size) {
    await rm(file, { force: true });
    return null;
  }
  return hash.digest('hex');
}

export function createAssetStore(dataDir: string, now: () => number = Date.now): AssetStore {
  const dir = path.join(dataDir, 'assets');
  const uploads = path.join(dir, '.uploads');
  mkdirSync(uploads, { recursive: true });
  const salt = loadSalt(dataDir);
  const offered = new Map<string, Offered>();
  const objectFile = (id: string): string => path.join(dir, id);
  const metaFile = (id: string): string => path.join(dir, `${id}.json`);
  const sessionDir = (id: string): string => path.join(uploads, id);
  /** Whether `sha256` is the content an id names: the id is its HMAC under the salt. */
  const names = (id: string, sha256: string): boolean => createHmac('sha256', salt).update(sha256).digest('hex') === id;

  async function readMeta(id: string): Promise<Meta | null> {
    try {
      const value: unknown = JSON.parse(await readFile(metaFile(id), 'utf8'));
      if (!isRecord(value) || typeof value.mime !== 'string' || !isSize(value.size) || !isAssetKind(value.kind)) return null;
      return { mime: value.mime, size: value.size, kind: value.kind };
    } catch {
      return null;
    }
  }

  /** The stored objects with their size and when they were last used (the meta file's time), oldest first. */
  async function stored(): Promise<{ id: string; size: number; usedAt: number }[]> {
    const entries: { id: string; size: number; usedAt: number }[] = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (!isAssetId(id)) continue;
      const meta = await readMeta(id);
      const info = await stat(metaFile(id)).catch(() => null);
      if (meta !== null && info !== null) entries.push({ id, size: meta.size, usedAt: info.mtimeMs });
    }
    return entries.sort((a, b) => a.usedAt - b.usedAt);
  }

  async function remove(id: string): Promise<void> {
    await rm(metaFile(id), { force: true });
    await rm(objectFile(id), { force: true });
    await rm(sessionDir(id), { recursive: true, force: true });
  }

  /** Lets go of the least recently used objects but `keep` until `needed` more bytes fit; whether they do now, and what went. */
  async function makeRoom(needed: number, keep: ReadonlySet<string>): Promise<{ fits: boolean; count: number; bytes: number }> {
    const entries = await stored();
    let used = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const offer of offered.values()) used += offer.size;
    let count = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (used + needed <= STORE_LIMIT) break;
      if (keep.has(entry.id)) continue;
      await remove(entry.id);
      used -= entry.size;
      count += 1;
      bytes += entry.size;
    }
    return { fits: used + needed <= STORE_LIMIT, count, bytes };
  }

  async function finish(id: string, file: string, meta: Meta): Promise<void> {
    await rename(file, objectFile(id));
    await writeFile(metaFile(id), JSON.stringify(meta), { mode: 0o600 });
    offered.delete(id);
    await rm(sessionDir(id), { recursive: true, force: true });
  }

  function forgetStaleOffers(): void {
    for (const [id, offer] of offered) if (now() - offer.at > OFFER_TTL_MS) offered.delete(id);
  }

  async function offer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request).catch(() => null);
    const list = isRecord(body) && Array.isArray(body.assets) ? body.assets : null;
    if (list === null || list.length > MAX_OFFERED) return sendJson(response, 400, { error: 'bad-offer' });
    forgetStaleOffers();
    const answers: Record<string, unknown> = {};
    const named = new Set<string>();
    const fresh: { id: string; kind: AssetKind; size: number }[] = [];
    for (const entry of list) {
      if (!isRecord(entry) || !isAssetId(entry.id) || !isSize(entry.size)) continue;
      named.add(entry.id);
      if (existsSync(metaFile(entry.id))) {
        // Used again: it is the last to go when room is made.
        await utimes(metaFile(entry.id), new Date(now()), new Date(now())).catch(() => undefined);
        answers[entry.id] = { answer: 'have' };
      } else if (entry.kind === 'tiles' || !isAssetKind(entry.kind)) {
        answers[entry.id] = { answer: 'refused', reason: 'kind' };
      } else if (entry.size > ASSET_CAPS[entry.kind] || entry.size > STORE_LIMIT) {
        answers[entry.id] = { answer: 'refused', reason: 'too-large' };
      } else {
        fresh.push({ id: entry.id, kind: entry.kind, size: entry.size });
      }
    }
    let evicted = { count: 0, bytes: 0 };
    for (const entry of fresh) {
      const room = await makeRoom(offered.has(entry.id) ? 0 : entry.size, named);
      evicted = { count: evicted.count + room.count, bytes: evicted.bytes + room.bytes };
      if (!room.fits) {
        answers[entry.id] = { answer: 'refused', reason: 'quota', retry: true };
        continue;
      }
      offered.set(entry.id, { kind: entry.kind, size: entry.size, at: now() });
      answers[entry.id] = entry.size <= SINGLE_MAX ? { answer: 'need', upload: 'single', partBytes: PART_BYTES } : { answer: 'need', upload: 'multipart', partBytes: PART_BYTES };
    }
    sendJson(response, 200, { assets: answers, ...(evicted.count > 0 && { evicted }) });
  }

  async function putWhole(id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (existsSync(metaFile(id))) return sendJson(response, 412, { error: 'stored' });
    const offer = offered.get(id);
    const sha256 = request.headers['x-asset-sha256'];
    const mime = mimeOf(request.headers['content-type']);
    if (offer === undefined) return sendJson(response, 409, { error: 'not-offered' });
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256) || !names(id, sha256) || !isMime(mime)) return sendJson(response, 400, { error: 'bad-upload' });
    const file = path.join(uploads, `${id}.${randomBytes(6).toString('hex')}.part`);
    const got = await receive(request, file, offer.size);
    if (got !== sha256) {
      await rm(file, { force: true });
      return sendJson(response, 400, { error: 'bad-upload' });
    }
    await finish(id, file, { mime, size: offer.size, kind: offer.kind });
    sendJson(response, 200, {});
  }

  async function readSession(id: string): Promise<PartsSession | null> {
    try {
      const value: unknown = JSON.parse(await readFile(path.join(sessionDir(id), 'session.json'), 'utf8'));
      if (!isRecord(value) || typeof value.uploadId !== 'string' || !isSize(value.size) || typeof value.mime !== 'string' || !Array.isArray(value.parts)) return null;
      return value as unknown as PartsSession;
    } catch {
      return null;
    }
  }

  async function startParts(id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const offer = offered.get(id);
    if (offer === undefined) return sendJson(response, 409, { error: 'not-offered' });
    const body = await readJson(request).catch(() => null);
    if (!isRecord(body) || body.size !== offer.size || typeof body.type !== 'string' || !isMime(mimeOf(body.type)) || !Array.isArray(body.parts)) return sendJson(response, 400, { error: 'bad-upload' });
    const parts: { sha256: string; size: number }[] = [];
    for (const part of body.parts) {
      if (!isRecord(part) || typeof part.sha256 !== 'string' || !SHA256_PATTERN.test(part.sha256) || !isSize(part.size) || part.size > PART_BYTES) return sendJson(response, 400, { error: 'bad-upload' });
      parts.push({ sha256: part.sha256, size: part.size });
    }
    if (parts.length === 0 || parts.length > Math.ceil(offer.size / 1024) || parts.reduce((sum, part) => sum + part.size, 0) !== offer.size) return sendJson(response, 400, { error: 'bad-upload' });
    const known = await readSession(id);
    const same = known !== null && known.size === offer.size && JSON.stringify(known.parts) === JSON.stringify(parts);
    const session: PartsSession = same ? known : { uploadId: randomBytes(12).toString('hex'), size: offer.size, mime: mimeOf(body.type), parts };
    if (!same) {
      await rm(sessionDir(id), { recursive: true, force: true });
      mkdirSync(sessionDir(id), { recursive: true });
      await writeFile(path.join(sessionDir(id), 'session.json'), JSON.stringify(session), { mode: 0o600 });
    }
    const arrived: number[] = [];
    for (let part = 1; part <= session.parts.length; part += 1) if (existsSync(path.join(sessionDir(id), String(part)))) arrived.push(part);
    sendJson(response, 200, { uploadId: session.uploadId, arrived });
  }

  async function putPart(id: string, part: number, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = await readSession(id);
    const expected = session?.parts[part - 1];
    if (session === null || expected === undefined) return sendJson(response, 409, { error: 'no-upload' });
    if (request.headers['x-asset-sha256'] !== expected.sha256) return sendJson(response, 400, { error: 'bad-upload' });
    const file = path.join(sessionDir(id), `${part}.${randomBytes(6).toString('hex')}.tmp`);
    const got = await receive(request, file, expected.size);
    if (got !== expected.sha256) {
      await rm(file, { force: true });
      return sendJson(response, 400, { error: 'bad-upload' });
    }
    await rename(file, path.join(sessionDir(id), String(part)));
    sendJson(response, 200, {});
  }

  async function complete(id: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (existsSync(metaFile(id))) return sendJson(response, 412, { error: 'stored' });
    const session = await readSession(id);
    const offer = offered.get(id);
    const sha256 = request.headers['x-asset-sha256'];
    if (session === null || offer === undefined) return sendJson(response, 409, { error: 'no-upload' });
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256) || !names(id, sha256)) return sendJson(response, 400, { error: 'bad-upload' });
    // A 409 names parts still missing: the plugin starts the upload again, which answers which arrived.
    for (let part = 1; part <= session.parts.length; part += 1) if (!existsSync(path.join(sessionDir(id), String(part)))) return sendJson(response, 409, { error: 'parts-missing' });
    const file = path.join(uploads, `${id}.${randomBytes(6).toString('hex')}.part`);
    const hash = createHash('sha256');
    const out = createWriteStream(file, { mode: 0o600 });
    for (let part = 1; part <= session.parts.length; part += 1) {
      const bytes = await readFile(path.join(sessionDir(id), String(part)));
      hash.update(bytes);
      if (!out.write(bytes)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    if (hash.digest('hex') !== sha256) {
      await rm(file, { force: true });
      await rm(sessionDir(id), { recursive: true, force: true });
      return sendJson(response, 400, { error: 'bad-upload' });
    }
    await finish(id, file, { mime: session.mime, size: session.size, kind: offer.kind });
    sendJson(response, 200, {});
  }

  async function gm(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    const method = request.method ?? 'GET';
    if (pathname === '/api/assets/salt') {
      if (method !== 'GET') return sendJson(response, 405, { error: 'method-not-allowed' });
      return sendJson(response, 200, { salt: salt.toString('base64') });
    }
    if (pathname === '/api/assets/offer') {
      if (method !== 'POST') return sendJson(response, 405, { error: 'method-not-allowed' });
      return offer(request, response);
    }
    const route = ROUTE.exec(pathname);
    if (route === null) return sendJson(response, 404, { error: 'not-found' });
    const [, id, step, part] = route as unknown as [string, string, string | undefined, string | undefined];
    if (step === undefined && method === 'PUT') return putWhole(id, request, response);
    if (step === undefined && method === 'DELETE') {
      offered.delete(id);
      await remove(id);
      return sendJson(response, 200, {});
    }
    if (step === 'parts' && part === undefined && method === 'POST') return startParts(id, request, response);
    if (step === 'parts' && part !== undefined && method === 'PUT') return putPart(id, Number(part), request, response);
    if (step === 'complete' && method === 'POST') return complete(id, request, response);
    // Tile pyramids are never offered a place, so their batches have no route here.
    sendJson(response, 404, { error: 'not-found' });
  }

  return {
    handleGm(request, response, pathname, isHost) {
      if (pathname !== '/api/assets' && !pathname.startsWith('/api/assets/')) return false;
      if (!isHost) {
        request.resume();
        sendJson(response, 401, { error: 'signed-out' });
        return true;
      }
      gm(request, response, pathname).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'store-failed' });
        else response.destroy();
      });
      return true;
    },
    serve(request, response, pathname) {
      const route = ROUTE.exec(pathname);
      if (route === null || route[2] !== undefined) return false;
      const id = route[1]!;
      void readMeta(id).then(async (meta) => {
        if (meta === null || !existsSync(objectFile(id))) return sendJson(response, 404, { error: 'not-found' });
        await utimes(metaFile(id), new Date(now()), new Date(now())).catch(() => undefined);
        response.writeHead(200, {
          'content-type': meta.mime,
          'content-length': meta.size,
          // The id names these bytes for good, and holding it is what reading them takes: any cache may keep them.
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          // Fetched by the player page, never shown as a page of its own: nothing in it may run.
          'content-security-policy': "default-src 'none'; sandbox",
        });
        if (request.method === 'HEAD') return void response.end();
        createReadStream(objectFile(id)).on('error', () => response.destroy()).pipe(response);
      }, () => sendJson(response, 500, { error: 'store-failed' }));
      return true;
    },
  };
}
