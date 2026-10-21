/**
 * The sources this script builds. Each is one edition of the SRD; its id, names and licence go
 * into the manifest, and its version must be raised whenever its notes change.
 */

import type { SourceLabel, SourceLicense } from '../../src/app/compendium/sourceFormat.ts';
import type { Edition } from './context.ts';

export interface SourceDefinition {
  edition: Edition;
  system: SourceLabel;
  book: SourceLabel;
  version: number;
  license: SourceLicense;
  attribution: string;
}

const CC_BY_4_0: SourceLicense = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/legalcode' };

/** Data credit: the notes are built from 5e-bits/5e-database (MIT), which transcribes the SRD. */
const DATA_CREDIT = 'Built by Atlas VTT from the JSON of 5e-bits/5e-database (https://github.com/5e-bits/5e-database, MIT licence). Atlas VTT reformatted the text as Obsidian notes.';

export const SOURCES: readonly SourceDefinition[] = [
  {
    edition: '2014',
    system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' },
    book: { id: 'srd-5.1', name: 'SRD 5.1' },
    version: 1,
    license: CC_BY_4_0,
    // Verbatim, as src/app/statblocks/presets/attributions.ts quotes it.
    attribution: `This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode. ${DATA_CREDIT}`,
  },
  {
    edition: '2024',
    system: { id: 'dnd5e-2024', name: 'D&D 5e 2024' },
    book: { id: 'srd-5.2.1', name: 'SRD 5.2.1' },
    version: 1,
    license: CC_BY_4_0,
    attribution: `This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. ${DATA_CREDIT}`,
  },
];
