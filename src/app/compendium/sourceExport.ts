/**
 * Exporting a folder of the vault's compendium as a source: a personal source the GM wrote, as a
 * zip of the same format as Atlas' own, which another vault installs from a file. The vault that
 * exports it records it as installed, so its campaigns can choose it at once.
 */

import type JSZip from 'jszip';
import { sha256 } from '../utils/hashing';
import type { InstalledSource } from './installedSources';
import { installRecordPath } from './installedSources';
import { OFFICIAL_SOURCES } from './officialSources';
import { PERSONAL_BOOK_ID } from './sourceTree';
import {
  COMPENDIUM_ROOT, SOURCE_FORMAT, SOURCE_MANIFEST, SOURCE_TYPE, isFolderName, sourceIdOf, sourceManifestProblem, sourceRootOf, zipPathOf,
  type CompendiumSourceManifest, type SourceFile, type SourceLabel,
} from './sourceFormat';
import type { CompendiumVault } from './sourceInstall';

/** The system and book names of a source folder, `Compendium/<system>/<book>`; null for any other path. */
export function sourceFolderNames(path: string): { system: string; book: string } | null {
  const [root, system, book, ...rest] = path.split('/');
  if (root !== COMPENDIUM_ROOT || rest.length > 0 || !isFolderName(system) || !isFolderName(book)) return null;
  return { system, book };
}

/** An id for a name: lower case letters, digits, `.` and `-`. */
export function slugOf(name: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 64);
  return slug === '' ? 'source' : slug;
}

/**
 * The manifest of a personal source. Its system takes the id of an installed source of the same
 * system name, so its books group together in the picker; a source already installed at this
 * folder keeps its id and goes up one version.
 */
export function personalManifest(folder: { system: string; book: string }, files: readonly SourceFile[], installed: readonly InstalledSource[]): CompendiumSourceManifest {
  const sameRoot = installed.find((source) => source.manifest.root === `${COMPENDIUM_ROOT}/${folder.system}/${folder.book}`)?.manifest;
  const sameSystem = installed.find((source) => source.manifest.system.name === folder.system)?.manifest.system;
  const system: SourceLabel = sameRoot?.system ?? sameSystem ?? { id: slugOf(folder.system), name: folder.system };
  const book: SourceLabel = sameRoot?.book ?? { id: slugOf(folder.book), name: folder.book };
  return {
    format: SOURCE_FORMAT,
    type: SOURCE_TYPE,
    id: sourceIdOf(system, book),
    system,
    book,
    version: (sameRoot?.version ?? 0) + 1,
    language: sameRoot?.language ?? 'und',
    root: sourceRootOf(system, book),
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

export interface ExportedSource {
  manifest: CompendiumSourceManifest;
  zip: Blob;
  fileName: string;
}

/**
 * Zips the files of a source folder (`paths`, read through `readBinary`) and records the source as
 * installed in `vault`. Throws with a message for the GM when the folder cannot be a source.
 */
export async function exportSource(
  vault: CompendiumVault,
  folder: { system: string; book: string },
  paths: readonly string[],
  readBinary: (path: string) => Promise<Uint8Array>,
  installed: readonly InstalledSource[],
  now: number = Date.now(),
): Promise<ExportedSource> {
  if (paths.length === 0) throw new Error('This folder holds no notes to export.');
  const contents = new Map<string, Uint8Array>();
  const files: SourceFile[] = [];
  for (const path of paths) {
    const data = await readBinary(path);
    contents.set(path, data);
    files.push({ path, sha256: await sha256(data) });
  }
  const manifest = personalManifest(folder, files, installed);
  // A system's Personal book is each vault's own: installed elsewhere it would take that vault's.
  if (manifest.book.id === PERSONAL_BOOK_ID) throw new Error(`${manifest.book.name} is the Personal book of ${manifest.system.name}: it cannot be exported. Copy its entries into a book of your own to share them.`);
  // Two folders whose names give one id ("My Book", "My-Book"): the record of the other would be overwritten.
  const other = installed.find((source) => source.manifest.id === manifest.id && source.manifest.root !== manifest.root);
  if (other) throw new Error(`${other.manifest.root} has the id ${manifest.id} already. Rename this folder before exporting it.`);
  // Exporting it would record Atlas' own source as a personal one, and its updates would stop.
  if (OFFICIAL_SOURCES.some((source) => source.id === manifest.id)) throw new Error(`${manifest.book.name} is one of Atlas' sources: install it from the compendium list instead.`);
  const problem = sourceManifestProblem(manifest);
  if (problem) throw new Error(problem);

  const { default: JSZipClass } = await import('jszip');
  const zip: JSZip = new JSZipClass();
  zip.file(SOURCE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of manifest.files) zip.file(zipPathOf(file.path), contents.get(file.path) ?? new Uint8Array());
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  const { files: listed, ...rest } = manifest;
  const record: InstalledSource = { manifest: rest, installedAt: now, files: Object.fromEntries(listed.map((file) => [file.path, { sha256: file.sha256 }])) };
  await vault.writeText(installRecordPath(manifest.id), `${JSON.stringify(record)}\n`);
  return { manifest, zip: blob, fileName: `${manifest.id.replace('/', '__')}-v${manifest.version}.zip` };
}
