// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import JSZip from 'jszip';
import { requestUrl } from 'obsidian';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CampaignService } from '../../../src/app/campaigns/CampaignService';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import type { Campaign } from '../../../src/app/campaigns/campaignTypes';
import { installRecordPath } from '../../../src/app/compendium/installedSources';
import type { OfficialSource } from '../../../src/app/compendium/officialSources';
import { sheetBooks } from '../../../src/app/compendium/sheetPicks';
import { SOURCE_FORMAT, SOURCE_MANIFEST, SOURCE_TYPE, zipPathOf, type CompendiumSourceManifest } from '../../../src/app/compendium/sourceFormat';
import { CompendiumLibraryDialog } from '../../../src/app/react/components/dashboard/compendium/CompendiumLibraryDialog';
import { CompendiumSourcesDialog } from '../../../src/app/react/components/dashboard/compendium/CompendiumSourcesDialog';
import { sha256 } from '../../../src/app/utils/hashing';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const catalog = vi.hoisted(() => ({ sources: [] as OfficialSource[] }));
vi.mock('obsidian', async (original) => ({ ...(await original<typeof import('obsidian')>()), requestUrl: vi.fn() }));
vi.mock('../../../src/app/compendium/officialSources', () => ({ get OFFICIAL_SOURCES() { return catalog.sources; } }));

const SYSTEM = { id: 'dnd5e-2024', name: 'D&D 5e 2024' };
const NOTE = 'Compendium/D&D 5e 2024/SRD/Spells/Fireball.md';
const NOTE_TEXT = '---\natlas-compendium: spell\n---\nA bright streak.\n';

/** A source zip as the builder makes it, with the catalog entry that matches its bytes. */
async function officialSource(book: { id: string; name: string }, note: string): Promise<{ official: OfficialSource; zip: ArrayBuffer }> {
  const bytes = new TextEncoder().encode(NOTE_TEXT);
  const manifest: CompendiumSourceManifest = {
    format: SOURCE_FORMAT, type: SOURCE_TYPE, id: `${SYSTEM.id}/${book.id}`, system: SYSTEM, book, version: 1, language: 'en',
    root: `Compendium/${SYSTEM.name}/${book.name}`, files: [{ path: note, sha256: await sha256(bytes) }],
  };
  const zip = new JSZip();
  zip.file(SOURCE_MANIFEST, JSON.stringify(manifest));
  zip.file(zipPathOf(note), bytes);
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  const official: OfficialSource = { id: manifest.id, system: SYSTEM, book, version: 1, language: 'en', license: 'CC BY 4.0', url: `https://example.test/${book.id}.zip`, size: data.byteLength, sha256: await sha256(data) };
  return { official, zip: data };
}

let srd: Awaited<ReturnType<typeof officialSource>>;
let other: Awaited<ReturnType<typeof officialSource>>;

beforeAll(async () => {
  srd = await officialSource({ id: 'srd', name: 'SRD' }, NOTE);
  other = await officialSource({ id: 'other', name: 'Other' }, 'Compendium/D&D 5e 2024/Other/Spells/Light.md');
  catalog.sources = [srd.official, other.official];
});

const opened: ReturnType<typeof createInMemoryApp>[] = [];

afterEach(() => {
  cleanup();
  for (const vault of opened.splice(0)) CampaignFiles.release(vault.app);
  vi.restoreAllMocks();
});

const answerDownloads = (): void => {
  vi.mocked(requestUrl).mockImplementation((async (request: { url: string }) => ({
    status: 200,
    arrayBuffer: request.url === srd.official.url ? srd.zip : other.zip,
  })) as never);
};

describe('the compendium sources of the vault, without a world', () => {
  it('downloads a source in a vault without any world, and a character sheet then finds its book', async () => {
    const vault = createInMemoryApp({ files: {} });
    opened.push(vault);
    answerDownloads();
    render(<CompendiumLibraryDialog app={vault.app} onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download SRD' }));

    await waitFor(() => expect(vault.files.has(installRecordPath('dnd5e-2024/srd'))).toBe(true));
    expect(vault.files.get(NOTE)).toBe(NOTE_TEXT);
    expect(vault.files.has(installRecordPath('dnd5e-2024/other'))).toBe(false);
    expect(CampaignFiles.forApp(vault.app)).toBeUndefined();
    expect((await sheetBooks(vault.app)).map((book) => book.id)).toEqual(['dnd5e-2024/srd']);
    // The book is installed now: the dialog offers to remove it, not to download it again.
    expect(await screen.findByRole('button', { name: 'Remove SRD from the vault' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download SRD' })).toBeNull();
  });
});

describe("a world's compendium sources", () => {
  const FILE = `${CAMPAIGNS_FOLDER}/Witherwild/campaign.json`;

  async function worldDialog(): Promise<{ vault: ReturnType<typeof createInMemoryApp>; service: CampaignService; onClose: () => void }> {
    const vault = createInMemoryApp({ files: { [FILE]: `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1, sources: [] })}\n` } });
    opened.push(vault);
    answerDownloads();
    const files = CampaignFiles.open(vault.app);
    await files.load();
    const service = new CampaignService(files);
    const onClose = vi.fn();
    render(<CompendiumSourcesDialog app={vault.app} campaign={service.get('c1') as Campaign} service={service} onClose={onClose} />);
    return { vault, service, onClose };
  }

  it('offers only the installed sources, and installing one from the dialog it opens adds it to the choice', async () => {
    await worldDialog();
    expect(await screen.findByText('This vault has no compendium source yet. Install one first.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'SRD' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Install sources…' }));
    const library = await screen.findByRole('dialog', { name: 'Compendium sources' });
    fireEvent.click(within(library).getByRole('button', { name: 'Download SRD' }));

    expect(await screen.findByRole('checkbox', { name: 'SRD' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Other' })).toBeNull();
  });

  it('saves the books ticked among the installed ones, with their system\'s Personal book, and downloads nothing', async () => {
    const { service, onClose } = await worldDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Install sources…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Compendium sources' })).getByRole('button', { name: 'Download SRD' }));
    const box = await screen.findByRole('checkbox', { name: 'SRD' });
    vi.mocked(requestUrl).mockClear();

    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(service.get('c1')?.sources).toEqual(['dnd5e-2024/srd', 'dnd5e-2024/personal']);
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
