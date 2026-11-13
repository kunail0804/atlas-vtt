import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCampaign } from '../../../src/app/campaigns/campaignTypes';
import type { InstalledSource } from '../../../src/app/compendium/installedSources';

const vault = vi.hoisted(() => ({ campaigns: [] as unknown[], installed: [] as unknown[], playing: null as string | null }));

vi.mock('../../../src/app/campaigns/CampaignFiles', () => ({ CampaignFiles: { forApp: () => ({ entries: () => vault.campaigns }) } }));
vi.mock('../../../src/app/campaigns/campaignPlay', () => ({ CampaignPlay: { forApp: () => ({ playing: () => vault.playing }) } }));
vi.mock('../../../src/app/compendium/CompendiumService', () => ({ CompendiumService: { forApp: () => ({ installed: () => Promise.resolve(vault.installed) }) } }));

const { sheetBooks } = await import('../../../src/app/compendium/sheetPicks');

const source = (id: string): InstalledSource => ({
  manifest: { id, system: { id: 'dnd5e', name: 'D&D 5e' }, book: { name: id.toUpperCase() }, root: `Compendium/${id}` } as InstalledSource['manifest'],
  installedAt: 0,
  files: {},
});
const world = (id: string, sources: readonly string[], lastPlayed: number): StoredCampaign => ({ format: 1, id, name: id, createdAt: 0, sources, lastPlayed } as unknown as StoredCampaign);
const app = {} as App;
const ids = async (): Promise<string[]> => (await sheetBooks(app)).map((book) => book.id);

beforeEach(() => {
  vault.installed = [source('srd/phb'), source('srd/mm'), source('homebrew/dragons')];
  vault.campaigns = [world('strahd', ['srd/phb'], 2), world('caves', ['srd/mm'], 1)];
  vault.playing = null;
});

describe('the books a character sheet picks from', () => {
  it('are the sources of the world played', async () => {
    vault.playing = 'caves';
    expect(await ids()).toEqual(['srd/mm']);
  });

  it('are every installed source while no world is played, never the world played last', async () => {
    expect(await ids()).toEqual(['srd/phb', 'srd/mm', 'homebrew/dragons']);
  });

  it('are every installed source where the world played names none, or is gone', async () => {
    vault.campaigns = [world('strahd', [], 2)];
    vault.playing = 'strahd';
    expect(await ids()).toEqual(['srd/phb', 'srd/mm', 'homebrew/dragons']);
    vault.playing = 'deleted';
    expect(await ids()).toEqual(['srd/phb', 'srd/mm', 'homebrew/dragons']);
  });
});
