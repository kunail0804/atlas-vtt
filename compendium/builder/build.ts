/**
 * Builds the compendium source zips from a checkout of 5e-bits/5e-database.
 *
 *   node compendium/builder/build.ts --database <5e-database checkout> --out <folder>
 *
 * Writes one `<system>__<book>.zip` per source and `catalog.json`, which lists each zip with its
 * size and SHA-256: the values `src/app/compendium/officialSources.ts` must carry once the zips
 * are published.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSourceNotes } from './buildSource.ts';
import { manifestFor, packSource, sha256Hex } from './pack.ts';
import { SOURCES } from './sources.ts';

function argument(name: string): string {
  const position = process.argv.indexOf(`--${name}`);
  const value = position === -1 ? undefined : process.argv[position + 1];
  if (value === undefined) throw new Error(`Missing --${name} <path>.`);
  return resolve(value);
}

export const zipNameOf = (id: string): string => `${id.replace('/', '__')}.zip`;

async function main(): Promise<void> {
  const database = argument('database');
  const out = argument('out');
  mkdirSync(out, { recursive: true });
  const catalog = [];
  for (const source of SOURCES) {
    const notes = buildSourceNotes(database, source);
    const manifest = manifestFor(source, notes);
    const zip = await packSource(manifest, notes);
    const file = zipNameOf(manifest.id);
    writeFileSync(join(out, file), zip);
    catalog.push({ id: manifest.id, version: manifest.version, file, size: zip.byteLength, sha256: sha256Hex(zip), notes: notes.length });
    console.log(`${manifest.id} v${manifest.version}: ${notes.length} notes, ${zip.byteLength} bytes`);
  }
  writeFileSync(join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
}

await main();
