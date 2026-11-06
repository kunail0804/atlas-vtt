import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { offerAnswers, partSizes } from '../../src/app/online/gm/assets/assetRoutes.ts';
import { assetIdOf } from '../../src/app/online/gm/assets/assetIds.ts';
import { SINGLE_MAX } from '../relay/assetStore.ts';
import { startTestRelay, stopTestRelay, type TestRelay } from './helpers.ts';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** The salt as the plugin reads it (`saltOf`, which needs Obsidian): 32 bytes of base64. */
const saltOf = (value: unknown): Uint8Array<ArrayBuffer> | null => {
  if (typeof value !== 'string') return null;
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  return bytes.length === 32 ? bytes : null;
};

describe('the asset store of the relay', () => {
  let test: TestRelay;
  let token: string;
  let salt: Uint8Array<ArrayBuffer>;

  beforeEach(async () => {
    test = await startTestRelay();
    const tokenResponse = await fetch(`${test.gmOrigin}/auth/device/token`, { method: 'POST' });
    token = ((await tokenResponse.json()) as { access_token: string }).access_token;
    const read = await gm('/api/assets/salt');
    const parsed = saltOf(((await read.json()) as { salt: unknown }).salt);
    if (parsed === null) throw new Error('no salt');
    salt = parsed;
  });

  afterEach(async () => {
    await stopTestRelay(test);
  });

  function gm(pathname: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${test.gmOrigin}${pathname}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
  }

  async function offer(assets: object[]): Promise<ReturnType<typeof offerAnswers>> {
    const response = await gm('/api/assets/offer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assets }) });
    expect(response.status).toBe(200);
    return offerAnswers(await response.json());
  }

  it('hands out one salt, by which the plugin\'s ids are the relay\'s', async () => {
    const again = saltOf(((await (await gm('/api/assets/salt')).json()) as { salt: unknown }).salt);
    expect(again).toEqual(salt);
    const hash = 'b'.repeat(64);
    expect(await assetIdOf(salt, hash)).toBe(createHmac('sha256', Buffer.from(salt)).update(hash).digest('hex'));
  });

  it('takes an image offered and sent whole, then serves it to players by its id alone', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const hash = sha256(bytes);
    const id = await assetIdOf(salt, hash);
    expect((await offer([{ id, kind: 'image', size: bytes.length }])).get(id)).toMatchObject({ answer: 'need', upload: 'single' });
    const put = await gm(`/api/assets/${id}`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-asset-sha256': hash }, body: bytes });
    expect(put.status).toBe(200);
    expect((await offer([{ id, kind: 'image', size: bytes.length }])).get(id)).toEqual({ answer: 'have' });
    const served = await fetch(`${test.publicUrl.replace('ws', 'http')}/api/assets/${id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    // The same bytes again are already there.
    expect((await gm(`/api/assets/${id}`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-asset-sha256': hash }, body: bytes })).status).toBe(412);
  });

  it('refuses bytes that are not those the id names, an upload nobody offered, and a request without the GM\'s token', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const id = await assetIdOf(salt, sha256(bytes));
    await offer([{ id, kind: 'image', size: 3 }]);
    const other = new Uint8Array([9, 9, 9]);
    expect((await gm(`/api/assets/${id}`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-asset-sha256': sha256(other) }, body: other })).status).toBe(400);
    expect((await gm(`/api/assets/${id}`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-asset-sha256': sha256(bytes) }, body: new Uint8Array([1, 2, 3, 4]) })).status).toBe(400);
    const stray = await assetIdOf(salt, sha256(other));
    expect((await gm(`/api/assets/${stray}`, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-asset-sha256': sha256(other) }, body: other })).status).toBe(409);
    expect((await fetch(`${test.gmOrigin}/api/assets/salt`)).status).toBe(401);
    expect((await fetch(`${test.publicUrl.replace('ws', 'http')}/api/assets/${id}`)).status).toBe(404);
  });

  it('refuses tile pyramids for their kind, so maps come as images, and what is over its kind\'s cap', async () => {
    const id = 'c'.repeat(64);
    expect((await offer([{ id, kind: 'tiles', size: 10, tiles: { levels: 3, count: 20 } }])).get(id)).toEqual({ answer: 'refused', reason: 'kind' });
    expect((await offer([{ id, kind: 'text', size: 2 * 1024 * 1024 }])).get(id)).toEqual({ answer: 'refused', reason: 'too-large' });
  });

  it('takes a large object in parts, tells which parts arrived, and checks the whole', async () => {
    const size = SINGLE_MAX + 5;
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index += 4096) bytes[index] = index % 251;
    const hash = sha256(bytes);
    const id = await assetIdOf(salt, hash);
    const answer = (await offer([{ id, kind: 'video', size }])).get(id);
    expect(answer).toMatchObject({ answer: 'need', upload: 'multipart' });
    const sizes = partSizes(size, answer?.answer === 'need' ? answer.partBytes : 0);
    const parts: Uint8Array[] = [];
    let at = 0;
    for (const part of sizes) {
      parts.push(bytes.subarray(at, at + part));
      at += part;
    }
    const start = async (): Promise<{ uploadId: string; arrived: number[] }> => (await (await gm(`/api/assets/${id}/parts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size, type: 'video/webm', parts: parts.map((part) => ({ sha256: sha256(part), size: part.length })) }) })).json()) as { uploadId: string; arrived: number[] };
    const first = await start();
    expect(first.arrived).toEqual([]);
    expect((await gm(`/api/assets/${id}/parts/1`, { method: 'PUT', headers: { 'x-asset-sha256': sha256(parts[0]!) }, body: parts[0] })).status).toBe(200);
    // Parts still missing: the plugin starts again and hears which arrived.
    expect((await gm(`/api/assets/${id}/complete`, { method: 'POST', headers: { 'x-asset-sha256': hash } })).status).toBe(409);
    const resumed = await start();
    expect(resumed).toEqual({ uploadId: first.uploadId, arrived: [1] });
    for (let part = 2; part <= parts.length; part += 1) {
      expect((await gm(`/api/assets/${id}/parts/${part}`, { method: 'PUT', headers: { 'x-asset-sha256': sha256(parts[part - 1]!) }, body: parts[part - 1] })).status).toBe(200);
    }
    expect((await gm(`/api/assets/${id}/complete`, { method: 'POST', headers: { 'x-asset-sha256': hash } })).status).toBe(200);
    const served = await fetch(`${test.publicUrl.replace('ws', 'http')}/api/assets/${id}`);
    expect(served.headers.get('content-type')).toBe('video/webm');
    expect(sha256(new Uint8Array(await served.arrayBuffer()))).toBe(hash);
  });
});
