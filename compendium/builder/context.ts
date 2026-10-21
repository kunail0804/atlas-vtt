import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NoteRegistry, Property } from './notes.ts';
import { records, type Json } from './values.ts';

export type Edition = '2014' | '2024';

/** The kinds of compendium note, written as `atlas-compendium` in each note's frontmatter. */
export type EntryKind = 'spell' | 'monster' | 'class' | 'subclass' | 'species' | 'background' | 'feat' | 'item' | 'magic-item' | 'condition' | 'rule';

/** The folders inside a source, one per kind of entry. */
export const FOLDERS = {
  spells: 'Spells',
  monsters: 'Monsters',
  classes: 'Classes',
  subclasses: 'Subclasses',
  species: 'Species',
  backgrounds: 'Backgrounds',
  feats: 'Feats',
  equipment: 'Equipment',
  magicItems: 'Magic Items',
  conditions: 'Conditions',
  rules: 'Rules',
} as const;

export interface BuildContext {
  edition: Edition;
  systemId: string;
  sourceId: string;
  registry: NoteRegistry;
  /** The records of `5e-SRD-<name>.json`; empty when the edition has no such file. */
  data: (name: string) => Json[];
}

/** Reads the SRD files of one edition from a checkout of 5e-bits/5e-database. */
export function dataReader(databaseDir: string, edition: Edition): (name: string) => Json[] {
  const cache = new Map<string, Json[]>();
  return (name) => {
    const cached = cache.get(name);
    if (cached) return cached;
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(readFileSync(join(databaseDir, 'src', edition, 'en', `5e-SRD-${name}.json`), 'utf8'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const read = records(parsed).sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));
    cache.set(name, read);
    return read;
  };
}

/** The frontmatter every compendium note starts with. */
export function entryProperties(context: BuildContext, kind: EntryKind): Record<string, Property> {
  return { 'atlas-compendium': kind, 'atlas-system': context.systemId, 'atlas-source': context.sourceId };
}
