import type { App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCampaign } from '../../../src/app/campaigns/campaignTypes';
import type { InstalledSource } from '../../../src/app/compendium/installedSources';

const vault = vi.hoisted(() => ({ campaigns: [] as unknown[], installed: [] as unknown[], playing: null as string | null }));

vi.mock('../../../src/app/campaigns/CampaignFiles', () => ({ CampaignFiles: { forApp: () => ({ entries: () => vault.campaigns }) } }));
vi.mock('../../../src/app/campaigns/campaignPlay', () => ({ CampaignPlay: { forApp: () => ({ playing: () => vault.playing }) } }));
vi.mock('../../../src/app/compendium/CompendiumService', () => ({ CompendiumService: { forApp: () => ({ installed: () => Promise.resolve(vault.installed) }) } }));

const { sheetBooks } = await import('../../../src/app/compendium/sheetPicks');

const source = (id: string, system = 'dnd5e'): InstalledSource => ({
  manifest: { id, system: { id: system, name: system }, book: { name: id.toUpperCase() }, root: `Compendium/${id}` } as InstalledSource['manifest'],
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

describe('the books a character sheet picks from while no world is played', () => {
  const sheetOf = (template: string): Record<string, unknown> => ({ statblock: true, 'atlas-template': template, name: 'Lia' });
  const idsFor = async (sheet: Record<string, unknown> | null): Promise<string[]> => (await sheetBooks(app, sheet)).map((book) => book.id);

  beforeEach(() => {
    vault.installed = [
      source('dnd5e-2014/srd-5.1', 'dnd5e-2014'), source('dnd5e-2024/srd-5.2.1', 'dnd5e-2024'),
      source('dnd5e-2024/personal', 'dnd5e-2024'), source('dnd5e-2014/personal', 'dnd5e-2014'),
    ];
  });

  it("are the installed books of the sheet's rules only", async () => {
    expect(await idsFor(sheetOf('builtin:5e-2024-character'))).toEqual(['dnd5e-2024/srd-5.2.1', 'dnd5e-2024/personal']);
    expect(await idsFor(sheetOf('builtin:5e-2014-character'))).toEqual(['dnd5e-2014/srd-5.1', 'dnd5e-2014/personal']);
  });

  it('are every installed book for a note that is no character sheet', async () => {
    expect(await idsFor(null)).toHaveLength(4);
    expect(await idsFor({ name: 'Notes' })).toHaveLength(4);
  });

  it("are the played world's books whatever the sheet's rules", async () => {
    vault.campaigns = [world('mixed', ['dnd5e-2014/srd-5.1'], 1)];
    vault.playing = 'mixed';
    expect(await idsFor(sheetOf('builtin:5e-2024-character'))).toEqual(['dnd5e-2014/srd-5.1']);
  });
});
