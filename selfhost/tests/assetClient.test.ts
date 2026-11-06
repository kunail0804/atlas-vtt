import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestRelay, stopTestRelay, type TestRelay } from './helpers.ts';
import { AssetStoreClient } from '../../src/app/online/gm/assets/storeClient.ts';
import { assetIdOf } from '../../src/app/online/gm/assets/assetIds.ts';
import { partSizes } from '../../src/app/online/gm/assets/assetRoutes.ts';

// The GM's own client, as the plugin runs it: Obsidian's requestUrl is `fetch` here (`obsidian.ts`).

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('the plugin\'s asset store client against the relay', () => {
  let test: TestRelay;
  let client: AssetStoreClient;

  beforeEach(async () => {
    test = await startTestRelay();
    const tokenResponse = await fetch(`${test.gmOrigin}/auth/device/token`, { method: 'POST' });
    const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
    client = new AssetStoreClient(test.gmOrigin, () => token);
  });

  afterEach(async () => {
    await stopTestRelay(test);
  });

  async function idOf(bytes: Uint8Array): Promise<{ id: string; hash: string }> {
    const salt = await client.salt();
    if (!salt.ok || typeof salt.value !== 'string') throw new Error('no salt');
    const hash = sha256(bytes);
    return { id: await assetIdOf(new Uint8Array(Buffer.from(salt.value, 'base64')), hash), hash };
  }

  it('offers, uploads whole and hears it is held, as the publisher does', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { id, hash } = await idOf(bytes);
    const offered = await client.offer([{ id, kind: 'image', size: bytes.length }]);
    expect(offered.ok && offered.value.get(id)).toMatchObject({ answer: 'need', upload: 'single' });
    expect(await client.putWhole(id, bytes.buffer, 'image/png', hash)).toEqual({ ok: true, value: null });
    const again = await client.offer([{ id, kind: 'image', size: bytes.length }]);
    expect(again.ok && again.value.get(id)).toEqual({ answer: 'have' });
    expect(await client.remove(id)).toEqual({ ok: true, value: null });
  });

  it('uploads in parts and completes, and hears a pyramid is refused for its kind', async () => {
    const size = 64 * 1024 * 1024 + 3;
    const bytes = new Uint8Array(size).fill(7);
    const { id, hash } = await idOf(bytes);
    const offered = await client.offer([{ id, kind: 'video', size }, { id: 'f'.repeat(64), kind: 'tiles', size: 100, tiles: { levels: 2, count: 5 } }]);
    if (!offered.ok) throw new Error('offer failed');
    expect(offered.value.get('f'.repeat(64))).toEqual({ answer: 'refused', reason: 'kind' });
    const answer = offered.value.get(id);
    if (answer?.answer !== 'need') throw new Error('not needed');
    expect(answer.upload).toBe('multipart');
    const sizes = partSizes(size, answer.partBytes);
    const parts = sizes.map((part, index) => bytes.slice(index * answer.partBytes, index * answer.partBytes + part));
    const session = await client.startParts(id, size, 'video/webm', parts.map((part) => ({ sha256: sha256(part), size: part.length })));
    expect(session.ok).toBe(true);
    for (const [index, part] of parts.entries()) expect((await client.putPart(id, index + 1, part.buffer, sha256(part))).ok).toBe(true);
    expect(await client.complete(id, hash)).toEqual({ ok: true, value: null });
    const served = await fetch(`${test.publicUrl.replace('ws', 'http')}/api/assets/${id}`);
    expect(sha256(new Uint8Array(await served.arrayBuffer()))).toBe(hash);
  });
});
