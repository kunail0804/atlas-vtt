import { join, readJson, stateDir, writeJson } from './paths.ts';
import { VERSION } from './version.ts';

const RELEASES = 'https://api.github.com/repos/kunail0804/atlas-vtt/releases?per_page=30';
const TAG_PREFIX = 'launcher-v';
const CHECK_EVERY_MS = 24 * 60 * 60_000;

interface Checked {
  readonly at: number;
  readonly latest: string;
  readonly url: string;
}

/** [major, minor, patch] of `1.2.3`, or null for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/** The newest launcher release on GitHub, or null when GitHub does not answer in time. */
async function newestRelease(): Promise<{ latest: string; url: string } | null> {
  try {
    const response = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return null;
    const releases = (await response.json()) as { tag_name?: string; html_url?: string; draft?: boolean }[];
    let best: { latest: string; url: string } | null = null;
    for (const release of releases) {
      if (release.draft === true || typeof release.tag_name !== 'string' || !release.tag_name.startsWith(TAG_PREFIX)) continue;
      const version = release.tag_name.slice(TAG_PREFIX.length);
      if (parseVersion(version) === null) continue;
      if (best === null || isNewer(version, best.latest)) best = { latest: version, url: release.html_url ?? '' };
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * A line telling the GM a newer launcher exists, or null. GitHub is asked at most once a day; a
 * GitHub that does not answer costs three seconds at most and says nothing.
 */
export async function updateNotice(): Promise<string | null> {
  const file = join(stateDir(), 'update.json');
  let checked = await readJson<Checked>(file);
  if (checked === null || Date.now() - checked.at > CHECK_EVERY_MS) {
    const found = await newestRelease();
    if (found !== null) {
      checked = { at: Date.now(), ...found };
      await writeJson(file, checked).catch(() => undefined);
    }
  }
  if (checked === null || !isNewer(checked.latest, VERSION)) return null;
  return `Une nouvelle version du lanceur Atlas est disponible (${checked.latest}, tu as ${VERSION}). Télécharge-la ici : ${checked.url}`;
}
