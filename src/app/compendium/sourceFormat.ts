/**
 * The zip a compendium source travels in, read by Atlas and written by the build script in
 * `compendium/builder/`. The zip holds `manifest.json` and, under `files/`, the finished notes at
 * the vault paths they install to. Nothing here imports other modules, because the build script
 * runs this file directly in Node.
 */

export const SOURCE_FORMAT = 1;
export const SOURCE_TYPE = 'atlas-compendium-source';
export const SOURCE_MANIFEST = 'manifest.json';
export const SOURCE_FILES_DIR = 'files';
/** Every compendium note lives under this vault folder. */
export const COMPENDIUM_ROOT = 'Compendium';

/** A game system or a book: a stable id and the name shown in the source picker. */
export interface SourceLabel {
  id: string;
  name: string;
}

export interface SourceLicense {
  name: string;
  url: string;
}

export interface SourceFile {
  /** Vault path, under the manifest's `root`. */
  path: string;
  sha256: string;
}

export interface CompendiumSourceManifest {
  format: number;
  type: typeof SOURCE_TYPE;
  /** `<system id>/<book id>`. */
  id: string;
  system: SourceLabel;
  book: SourceLabel;
  /** Raised on every published change; an install compares versions to offer an update. */
  version: number;
  language: string;
  /** The vault folder all of the source's files live under: `Compendium/<system>/<book>`. */
  root: string;
  license?: SourceLicense;
  attribution?: string;
  files: SourceFile[];
}

const LABEL_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_NAME = 120;
const MAX_FILES = 20000;
/** Characters Obsidian refuses in file names, or that break links. */
const INVALID_NAME_CHARACTERS = /[*"\\/<>:|?#^[\]]/;

export const sourceIdOf = (system: SourceLabel, book: SourceLabel): string => `${system.id}/${book.id}`;

export const zipPathOf = (vaultPath: string): string => `${SOURCE_FILES_DIR}/${vaultPath}`;

/** Whether `id` can identify a system or a book: lower case letters, digits, `.` and `-`. */
export function isLabelId(id: unknown): id is string {
  return typeof id === 'string' && LABEL_ID.test(id);
}

/** Whether `id` is a source id, `<system id>/<book id>`. */
export function isSourceId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const parts = id.split('/');
  return parts.length === 2 && parts.every(isLabelId);
}

/** Whether `name` can name a folder in the vault: not empty, not hidden, no character Obsidian refuses. */
export function isFolderName(name: unknown): name is string {
  return typeof name === 'string'
    && name.trim() === name
    && name !== ''
    && name.length <= MAX_NAME
    && !name.startsWith('.')
    && !INVALID_NAME_CHARACTERS.test(name)
    && [...name].every((character) => character.charCodeAt(0) >= 0x20);
}

/** The folder a source installs to. */
export const sourceRootOf = (system: SourceLabel, book: SourceLabel): string => `${COMPENDIUM_ROOT}/${system.name}/${book.name}`;

/** Whether `path` is a vault path strictly inside `root`, with no empty, hidden or `..` segment. */
export function isPathInside(path: string, root: string): boolean {
  if (!path.startsWith(`${root}/`) || path.length > 1024) return false;
  return path.slice(root.length + 1).split('/').every(isFolderName);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLabel(value: unknown): value is SourceLabel {
  return isObject(value) && isLabelId(value.id) && isFolderName(value.name);
}

function isLicense(value: unknown): value is SourceLicense {
  return isObject(value) && typeof value.name === 'string' && typeof value.url === 'string';
}

function isSourceFile(value: unknown): value is SourceFile {
  return isObject(value) && typeof value.path === 'string' && typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

/**
 * Why `value` is not a manifest Atlas can install, or null when it is one. Every file must lie
 * inside the source's own folder, so a source never writes anywhere else in the vault.
 */
export function sourceManifestProblem(value: unknown): string | null {
  if (!isObject(value) || value.type !== SOURCE_TYPE || typeof value.format !== 'number') return 'This file is not an Atlas compendium source.';
  if (value.format > SOURCE_FORMAT) return 'This compendium source needs a newer version of Atlas.';
  const { system, book, files } = value;
  if (!isLabel(system) || !isLabel(book)) return 'The source names its game system or book wrongly.';
  if (value.id !== sourceIdOf(system, book)) return 'The source id does not match its game system and book.';
  if (value.root !== sourceRootOf(system, book)) return 'The source does not install into its own folder.';
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) return 'The source has no valid version.';
  if (typeof value.language !== 'string' || value.language === '') return 'The source names no language.';
  if (value.license !== undefined && !isLicense(value.license)) return 'The source licence is unreadable.';
  if (value.attribution !== undefined && typeof value.attribution !== 'string') return 'The source attribution is unreadable.';
  if (!Array.isArray(files) || files.length > MAX_FILES || !files.every(isSourceFile)) return 'The source file list is damaged.';
  const root = sourceRootOf(system, book);
  const seen = new Set<string>();
  for (const file of files) {
    if (!isPathInside(file.path, root)) return `The source holds a file outside its folder: ${file.path}`;
    const key = file.path.toLowerCase();
    if (seen.has(key)) return `The source holds the same file twice: ${file.path}`;
    seen.add(key);
  }
  return null;
}
