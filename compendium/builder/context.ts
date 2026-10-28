import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NoteRegistry, Property } from './notes.ts';
import { records, type Json } from './values.ts';
import { ENTRY_FOLDERS, ENTRY_KIND_KEY, ENTRY_SOURCE_KEY, ENTRY_SYSTEM_KEY, type EntryKind } from '../../src/app/compendium/sourceFormat.ts';

export type Edition = '2014' | '2024';

export type { EntryKind };

/** The folders inside a source, one per kind of entry. */
export const FOLDERS = {
  spells: ENTRY_FOLDERS.spell,
  monsters: ENTRY_FOLDERS.monster,
  classes: ENTRY_FOLDERS.class,
  subclasses: ENTRY_FOLDERS.subclass,
  species: ENTRY_FOLDERS.species,
  backgrounds: ENTRY_FOLDERS.background,
  feats: ENTRY_FOLDERS.feat,
  equipment: ENTRY_FOLDERS.item,
  magicItems: ENTRY_FOLDERS['magic-item'],
  conditions: ENTRY_FOLDERS.condition,
  rules: ENTRY_FOLDERS.rule,
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
  return { [ENTRY_KIND_KEY]: kind, [ENTRY_SYSTEM_KEY]: context.systemId, [ENTRY_SOURCE_KEY]: context.sourceId };
}
