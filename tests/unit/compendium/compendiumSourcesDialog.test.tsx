import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { CampaignService } from '../../../src/app/campaigns/CampaignService';
import type { Campaign } from '../../../src/app/campaigns/campaignTypes';
import type { OfficialSource } from '../../../src/app/compendium/officialSources';
import { CompendiumSourcesDialog } from '../../../src/app/react/components/dashboard/compendium/CompendiumSourcesDialog';
import { CampaignSourcesSetting } from '../../../src/app/react/components/dashboard/compendium/CampaignSourcesSetting';
import { sha256 } from '../../../src/app/utils/hashing';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { memoryCampaigns } from '../../mocks/memoryCampaigns';
import { at, ID, zipped } from './sourceZips';

vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<typeof import('obsidian')>()), requestUrl: vi.fn() }));

/** Atlas' list, as the test serves it: the 2014 SRD of the test zip, and a 2024 book. */
const catalog = vi.hoisted((): OfficialSource[] => []);
vi.mock('../../../src/app/compendium/officialSources', () => ({ OFFICIAL_SOURCES: catalog }));

const CAMPAIGN: Campaign = { id: 'c-1', name: 'Witherwild', createdAt: 1 };
let zip = new ArrayBuffer(0);

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  zip = await zipped(1, { [at('Spells/Fireball.md')]: 'fire' });
  catalog.splice(0, catalog.length,
    {
      id: ID, system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' }, book: { id: 'srd-5.1', name: 'SRD 5.1' }, version: 1, language: 'en',
      license: 'CC BY 4.0', url: 'https://example.org/2014.zip', size: zip.byteLength, sha256: await sha256(zip),
    },
    {
      id: 'dnd5e-2024/srd-5.2.1', system: { id: 'dnd5e-2024', name: 'D&D 5e 2024' }, book: { id: 'srd-5.2.1', name: 'SRD 5.2.1' }, version: 1,
      language: 'en', license: 'CC BY 4.0', url: 'https://example.org/2024.zip', size: 1_000_000, sha256: 'b'.repeat(64),
    });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(campaign: Campaign = CAMPAIGN): { service: CampaignService; files: Map<string, string>; onClose: ReturnType<typeof vi.fn> } {
  const { app, files } = createInMemoryApp();
  const service = new CampaignService(memoryCampaigns([{ ...campaign }]));
  const onClose = vi.fn();
  render(<CompendiumSourcesDialog app={app} campaign={campaign} service={service} onClose={onClose} />);
  return { service, files, onClose };
}

describe('the compendium source picker', () => {
  it('ticks every book of a game system at once, downloads it on save and stores the campaign\'s choice', async () => {
    const { service, files, onClose } = renderDialog();
    expect(await screen.findByText('Download · 1.0 MB')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('All of D&D 5e 2014'));
    expect((screen.getByRole('checkbox', { name: 'SRD 5.1' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'SRD 5.2.1' }) as HTMLInputElement).checked).toBe(false);
    // The Personal book is no choice: Atlas adds it.
    expect(screen.queryByRole('checkbox', { name: 'Personal' })).toBeNull();

    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, arrayBuffer: zip } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(1);
    expect(files.get(at('Spells/Fireball.md'))).toBe('fire');
    expect(service.get(CAMPAIGN.id)?.sources).toEqual([ID, 'dnd5e-2014/personal']);
    // The personal book is made with the ids the picker named, beside the SRD.
    const record = JSON.parse(files.get('atlas-vtt/compendium/dnd5e-2014__personal.json') ?? 'null') as { manifest: { root: string; system: { id: string } } } | null;
    expect(record?.manifest.root).toBe('Compendium/D&D 5e 2014/Personal');
    expect(record?.manifest.system.id).toBe('dnd5e-2014');
  });

  it('keeps the dialog open and the campaign unchanged when a download fails', async () => {
    const { service, onClose } = renderDialog();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'SRD 5.1' }));
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 503, arrayBuffer: new ArrayBuffer(0) } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not install SRD 5.1');
    expect(onClose).not.toHaveBeenCalled();
    expect(service.get(CAMPAIGN.id)?.sources).toBeUndefined();
  });

  it('lists a source the campaign names but the vault lacks, so it can be unticked', async () => {
    renderDialog({ ...CAMPAIGN, sources: ['homebrew/my-book'] });
    expect(await screen.findByText('Not in this vault')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'homebrew/my-book' }) as HTMLInputElement).checked).toBe(true);
  });

  it('opens on its own on the page of a campaign just created', async () => {
    const { app } = createInMemoryApp();
    const service = new CampaignService(memoryCampaigns([{ ...CAMPAIGN }]));
    render(<CampaignSourcesSetting app={app} campaign={CAMPAIGN} service={service} disabled={false} openAtStart />);
    expect(await screen.findByText('Compendium of Witherwild')).toBeTruthy();
  });
});
