import JSZip from 'jszip';
import type { CompendiumSourceManifest } from '../../../src/app/compendium/sourceFormat';
import { sha256 } from '../../../src/app/utils/hashing';

export const ROOT = 'Compendium/D&D 5e 2014/SRD 5.1';
export const ID = 'dnd5e-2014/srd-5.1';
export const at = (name: string): string => `${ROOT}/${name}`;

async function manifestOf(version: number, files: Record<string, string>): Promise<CompendiumSourceManifest> {
  const listed = [];
  for (const [path, text] of Object.entries(files)) listed.push({ path, sha256: await sha256(new TextEncoder().encode(text)) });
  return {
    format: 1, type: 'atlas-compendium-source', id: ID,
    system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' }, book: { id: 'srd-5.1', name: 'SRD 5.1' },
    version, language: 'en', root: ROOT, files: listed,
  };
}

/** A source as a real zip, opened by Atlas' reader. */
export async function zipped(version: number, files: Record<string, string>, tamper?: (zip: JSZip) => void): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(await manifestOf(version, files)));
  for (const [path, text] of Object.entries(files)) zip.file(`files/${path}`, text);
  tamper?.(zip);
  return zip.generateAsync({ type: 'arraybuffer' });
}
