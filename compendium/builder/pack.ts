/**
 * A source's notes as a zip: `manifest.json`, `ATTRIBUTION.md` and the notes under `files/` at
 * their vault paths. The same notes always give the same bytes (fixed dates, sorted entries), so
 * a rebuild can be checked against the published SHA-256.
 */

import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  SOURCE_FORMAT, SOURCE_MANIFEST, SOURCE_TYPE, sourceIdOf, sourceManifestProblem, sourceRootOf, zipPathOf,
  type CompendiumSourceManifest,
} from '../../src/app/compendium/sourceFormat.ts';
import type { Note } from './notes.ts';
import type { SourceDefinition } from './sources.ts';

const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));

export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

export function manifestFor(source: SourceDefinition, notes: readonly Note[]): CompendiumSourceManifest {
  const manifest: CompendiumSourceManifest = {
    format: SOURCE_FORMAT,
    type: SOURCE_TYPE,
    id: sourceIdOf(source.system, source.book),
    system: source.system,
    book: source.book,
    version: source.version,
    language: 'en',
    root: sourceRootOf(source.system, source.book),
    license: source.license,
    attribution: source.attribution,
    files: [...notes].sort((a, b) => (a.path < b.path ? -1 : 1)).map((note) => ({ path: note.path, sha256: sha256Hex(note.text) })),
  };
  const problem = sourceManifestProblem(manifest);
  if (problem) throw new Error(`The ${manifest.id} manifest is invalid: ${problem}`);
  return manifest;
}

export async function packSource(manifest: CompendiumSourceManifest, notes: readonly Note[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const options = { date: FIXED_DATE, createFolders: false } as const;
  zip.file(SOURCE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, options);
  zip.file('ATTRIBUTION.md', `${manifest.attribution ?? ''}\n`, options);
  for (const note of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) zip.file(zipPathOf(note.path), note.text, options);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
}
