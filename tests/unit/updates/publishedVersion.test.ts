import { describe, expect, it } from 'vitest';
import { IMAGE_TAGS_URL, readPublishedVersion, type FetchText } from '../../../src/app/updates/publishedVersion';

const answering = (status: number, body: unknown): FetchText => async (url) => {
  expect(url).toBe(IMAGE_TAGS_URL);
  return { status, text: typeof body === 'string' ? body : JSON.stringify(body) };
};

describe('the published version of the fork', () => {
  it('is the newest plugin version among the Docker image\'s build tags', async () => {
    const tags = { results: [{ name: 'latest' }, { name: 'sha-0123abc' }, { name: '0.12.1-selfhost.3' }, { name: '0.12.10-selfhost.1' }, { name: '0.9.0-selfhost.7' }] };
    expect(await readPublishedVersion(answering(200, tags))).toBe('0.12.10');
  });

  it('is none where the tags cannot be read or name no build', async () => {
    expect(await readPublishedVersion(answering(200, { results: [{ name: 'latest' }, { name: '1.0.0' }, { name: '1.0.0-beta.1-selfhost.1' }] }))).toBeNull();
    expect(await readPublishedVersion(answering(404, { results: [{ name: '0.12.1-selfhost.1' }] }))).toBeNull();
    expect(await readPublishedVersion(answering(200, 'not json'))).toBeNull();
    expect(await readPublishedVersion(async () => { throw new Error('offline'); })).toBeNull();
  });
});
