import type { SourceLabel } from './sourceFormat';

/**
 * The sources Atlas offers to download, built by `compendium/builder/build.ts` and published as
 * assets of the GitHub release `compendium-v<version>`. Size and SHA-256 are the zip's, copied
 * from the build's `catalog.json`: Atlas refuses a download that does not match them.
 */
export interface OfficialSource {
  id: string;
  system: SourceLabel;
  book: SourceLabel;
  version: number;
  language: string;
  license: string;
  url: string;
  size: number;
  sha256: string;
}

const RELEASE = 'https://github.com/kunail0804/atlas-vtt/releases/download/compendium-v1';

export const OFFICIAL_SOURCES: readonly OfficialSource[] = [
  {
    id: 'dnd5e-2014/srd-5.1',
    system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' },
    book: { id: 'srd-5.1', name: 'SRD 5.1' },
    version: 1,
    language: 'en',
    license: 'CC BY 4.0',
    url: `${RELEASE}/dnd5e-2014__srd-5.1.zip`,
    size: 1177832,
    sha256: 'c46b4b265fc0a4e5a88319f59494374821ed8b73f3d086c2f731826ea18a5ea6',
  },
  {
    id: 'dnd5e-2024/srd-5.2.1',
    system: { id: 'dnd5e-2024', name: 'D&D 5e 2024' },
    book: { id: 'srd-5.2.1', name: 'SRD 5.2.1' },
    version: 1,
    language: 'en',
    license: 'CC BY 4.0',
    url: `${RELEASE}/dnd5e-2024__srd-5.2.1.zip`,
    size: 971230,
    sha256: '0c76bc2cb3d9fe630524415d33dae7918c75c42dd5ef7390a30e6cd535611056',
  },
];
