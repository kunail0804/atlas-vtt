import { ATLAS_VTT_DIR } from '../services/assetPaths';
import { isRecord } from '../utils/guards';
import { isSourceId, sourceManifestProblem, type CompendiumSourceManifest } from './sourceFormat';

/** Install records live here, one JSON file per source, and sync with the vault. */
export const INSTALLS_DIR = `${ATLAS_VTT_DIR}/compendium`;

/** One installed file: what the source carried and what the vault held right after the install (the same bytes). */
export interface InstalledFile {
  sha256: string;
}

/**
 * What the vault got from a source's last install: the manifest without its file list, and the
 * fingerprint of every file written. The next update compares against it to tell the GM's edits
 * from the source's changes.
 */
export interface InstalledSource {
  manifest: Omit<CompendiumSourceManifest, 'files'>;
  installedAt: number;
  files: Record<string, InstalledFile>;
}

export const installRecordPath = (id: string): string => `${INSTALLS_DIR}/${id.replace('/', '__')}.json`;

/** An install record as Atlas reads its file, or null when the file is not one. */
export function parseInstalledSource(text: string): InstalledSource | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || !isRecord(parsed.files) || typeof parsed.installedAt !== 'number') return null;
  // The manifest is checked as a whole with an empty file list, then the file records one by one.
  if (sourceManifestProblem({ ...parsed.manifest, files: [] }) !== null || !isSourceId(parsed.manifest.id)) return null;
  const files: Record<string, InstalledFile> = {};
  for (const [path, file] of Object.entries(parsed.files)) {
    if (isRecord(file) && typeof file.sha256 === 'string') files[path] = { sha256: file.sha256 };
  }
  const { files: _files, ...manifest } = parsed.manifest as unknown as CompendiumSourceManifest;
  return { manifest, installedAt: parsed.installedAt, files };
}
