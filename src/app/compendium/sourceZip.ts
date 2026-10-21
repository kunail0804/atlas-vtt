import type JSZip from 'jszip';
import { sha256 } from '../utils/hashing';
import { SOURCE_MANIFEST, sourceManifestProblem, zipPathOf, type CompendiumSourceManifest } from './sourceFormat';

/** A source zip whose manifest is sound and whose every file matches its SHA-256. */
export interface OpenedSource {
  manifest: CompendiumSourceManifest;
  /** The bytes of a file the manifest lists, by vault path. */
  read: (path: string) => Promise<Uint8Array>;
}

/** Reads a source zip and checks every file before anything is written. Throws with a message for the GM. */
export async function openSource(data: ArrayBuffer): Promise<OpenedSource> {
  const { default: JSZip } = await import('jszip');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This file is not a readable zip archive.');
  }
  const entry = zip.file(SOURCE_MANIFEST);
  if (!entry) throw new Error('This file is not an Atlas compendium source.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await entry.async('string'));
  } catch {
    throw new Error('This compendium source is damaged.');
  }
  const problem = sourceManifestProblem(parsed);
  if (problem) throw new Error(problem);
  // Checked by sourceManifestProblem just above.
  const manifest = parsed as CompendiumSourceManifest;

  const contents = new Map<string, Uint8Array>();
  for (const file of manifest.files) {
    const bytes = await zip.file(zipPathOf(file.path))?.async('uint8array');
    if (!bytes || await sha256(bytes) !== file.sha256) throw new Error(`This compendium source is damaged: ${file.path} does not match its checksum.`);
    contents.set(file.path, bytes);
  }
  return {
    manifest,
    read: async (path) => {
      const bytes = contents.get(path);
      if (!bytes) throw new Error(`The source holds no file ${path}.`);
      return bytes;
    },
  };
}
