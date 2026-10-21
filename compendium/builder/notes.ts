/**
 * Writing compendium notes: their file names, the links between them and their text, which is
 * YAML frontmatter followed by Markdown.
 */

import { stringify } from 'yaml';

export interface Note {
  /** Vault path. */
  path: string;
  text: string;
}

/** A frontmatter value: what YAML writes and Obsidian's properties read. */
export type Property = string | number | boolean | null | Property[] | { [key: string]: Property };

/** Characters Obsidian refuses in file names, or that break links. */
const INVALID_NAME_CHARACTERS = /[*"\\/<>:|?#^[\]]/g;

/** A file name for `name`: refused characters become `-`, leading dots go. */
export function fileStem(name: string): string {
  const cleaned = name.replace(INVALID_NAME_CHARACTERS, '-').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? 'Untitled' : cleaned;
}

/** Properties without empty values, so a note shows no blank lines for what the SRD leaves out. */
function withoutEmpty(properties: Record<string, Property | undefined>): Record<string, Property> {
  const kept: Record<string, Property> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    kept[key] = value;
  }
  return kept;
}

/** The note's text: frontmatter, then the body with one trailing newline. */
export function noteText(properties: Record<string, Property | undefined>, body: string): string {
  const yaml = stringify(withoutEmpty(properties), { lineWidth: 0 });
  const trimmed = body.trim();
  return `---\n${yaml}---\n${trimmed === '' ? '' : `${trimmed}\n`}`;
}

/** A Markdown table; cells have their `|` escaped so a value cannot split a column. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/**
 * Where every note of a source goes, decided before any note is written so notes can link to
 * each other. Names are unique per folder: a second "Shield" in the same folder becomes
 * "Shield (2)". Lookups go by category and SRD index, which never collide.
 */
export class NoteRegistry {
  private readonly paths = new Map<string, { path: string; name: string }>();
  private readonly taken = new Set<string>();
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Reserves the note of `index` in `folder` and returns its vault path. */
  register(folder: string, index: string, name: string): string {
    const key = `${folder}:${index}`;
    const existing = this.paths.get(key);
    if (existing) return existing.path;
    const stem = fileStem(name);
    let path = `${this.root}/${folder}/${stem}.md`;
    for (let copy = 2; this.taken.has(path.toLowerCase()); copy++) path = `${this.root}/${folder}/${stem} (${copy}).md`;
    this.taken.add(path.toLowerCase());
    this.paths.set(key, { path, name });
    return path;
  }

  pathOf(folder: string, index: string): string | undefined {
    return this.paths.get(`${folder}:${index}`)?.path;
  }

  /**
   * A wiki link to the note of `index` in `folder`, by full path so that a vault holding both
   * editions links within the right one; `label` when no such note exists.
   */
  link(folder: string, index: string, label: string): string {
    const entry = this.paths.get(`${folder}:${index}`);
    if (!entry) return label;
    return `[[${entry.path.replace(/\.md$/, '')}|${label || entry.name}]]`;
  }
}
