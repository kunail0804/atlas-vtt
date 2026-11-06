import { requestUrl } from 'obsidian';
import { compareVersions, isReleaseVersion } from '../changelog/version';
import { isRecord } from '../utils/guards';

/**
 * The fork's published builds: the tags of its Docker image, which `atlas start` pulls and whose plugin
 * it copies into the vault. A build is tagged `<plugin version>-selfhost.<n>` (`.github/WORKFLOW.md`).
 */
export const IMAGE_TAGS_URL = 'https://hub.docker.com/v2/repositories/kunail0804/atlas-relay/tags?page_size=100&ordering=last_updated';
/** A tag of a published build, and the plugin version it carries. */
const BUILD_TAG = /^(\d+\.\d+\.\d+)-selfhost\.\d+$/;
/** A page of tags is a few tens of kilobytes; anything far larger is not one. */
const MAX_TAGS_LENGTH = 1024 * 1024;

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;

/** Obsidian's `requestUrl`, which answers errors with their status instead of throwing. */
export const obsidianFetch: FetchText = async (url) => {
  const response = await requestUrl({ url, throw: false });
  return { status: response.status, text: response.text };
};

/**
 * The newest plugin version the fork's Docker image carries, or null when its tags cannot be read
 * or name no build. Never throws. A build that changed only the relay or the player page carries the
 * same plugin version, so it is not told apart here.
 */
export async function readPublishedVersion(fetch: FetchText): Promise<string | null> {
  try {
    const { status, text } = await fetch(IMAGE_TAGS_URL);
    if (status !== 200 || text.length > MAX_TAGS_LENGTH) return null;
    const page: unknown = JSON.parse(text);
    const results = isRecord(page) && Array.isArray(page.results) ? page.results : [];
    let newest: string | null = null;
    for (const result of results) {
      const name = isRecord(result) && typeof result.name === 'string' ? result.name : '';
      const version = BUILD_TAG.exec(name)?.[1];
      if (version === undefined || !isReleaseVersion(version)) continue;
      if (newest === null || compareVersions(version, newest) > 0) newest = version;
    }
    return newest;
  } catch {
    return null;
  }
}
