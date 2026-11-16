import { TFile, type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledSource } from '../../../../src/app/compendium/installedSources';
import type { GmMessage } from '../../../../src/app/online/protocol/index';

const state = vi.hoisted(() => ({ campaigns: [] as unknown[], installed: [] as unknown[], playing: null as string | null }));

vi.mock('../../../../src/app/campaigns/CampaignFiles', () => ({ CampaignFiles: { forApp: () => ({ entries: () => state.campaigns }) } }));
vi.mock('../../../../src/app/campaigns/campaignPlay', () => ({ CampaignPlay: { forApp: () => ({ playing: () => state.playing, onChange: () => () => undefined }) } }));
vi.mock('../../../../src/app/compendium/CompendiumService', () => ({ CompendiumService: { forApp: () => ({ installed: () => Promise.resolve(state.installed), onChange: () => () => undefined }) } }));

const { tableCompendium } = await import('../../../../src/app/online/gm/compendium/tableCompendium');

const ALICE = 'aaaaaaaaaaaaaaaaaaaa';
const SHEET = 'Players/Lia.md';
const SPELL_2014 = 'Compendium/dnd5e-2014/srd-5.1/Spells/Fireball.md';
const SPELL_2024 = 'Compendium/dnd5e-2024/srd-5.2.1/Spells/Fireball.md';

const book = (system: string, id: string): InstalledSource => ({
  manifest: { id: `${system}/${id}`, system: { id: system, name: system }, book: { name: id }, root: `Compendium/${system}/${id}` } as InstalledSource['manifest'],
  installedAt: 0,
  files: {},
});

/** A vault with one character sheet of `template` and a Fireball in a book of each edition. */
function vault(template: string): App {
  const frontmatter: Record<string, Record<string, unknown>> = {
    [SHEET]: { statblock: true, 'atlas-template': template, name: 'Lia' },
    [SPELL_2014]: { 'atlas-compendium': 'spell', name: 'Fireball' },
    [SPELL_2024]: { 'atlas-compendium': 'spell', name: 'Fireball' },
  };
  const files = new Map(Object.keys(frontmatter).map((path) => [path, new TFile(path)]));
  return {
    vault: {
      getFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [...files.values()],
      cachedRead: () => Promise.resolve('---\nname: Fireball\n---\n'),
    },
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }) },
  } as unknown as App;
}

/** The book of the entry the sheet's button opens for Alice; the sheet's modules load on first use. */
async function opened(template: string): Promise<string | undefined> {
  const sent: GmMessage[] = [];
  const table = tableCompendium(vault(template), (body) => sent.push(body), () => 'Alice', () => SHEET);
  table.share.receive(ALICE, { t: 'sheet-view', kind: 'spell', name: 'Fireball' });
  await vi.waitFor(() => expect(sent.some((body) => body.t === 'compendium-entry' || body.t === 'compendium-missing')).toBe(true), { timeout: 10_000 });
  const entry = sent.find((body) => body.t === 'compendium-entry');
  return entry?.t === 'compendium-entry' ? entry.page.source : undefined;
}

beforeEach(() => {
  state.installed = [book('dnd5e-2014', 'srd-5.1'), book('dnd5e-2024', 'srd-5.2.1')];
  state.campaigns = [];
  state.playing = null;
});

describe("the entry a sheet's button opens at the table", () => {
  it("comes from a book of the sheet's rules while no world is played", async () => {
    expect(await opened('builtin:5e-2024-character')).toBe('srd-5.2.1');
    expect(await opened('builtin:5e-2014-character')).toBe('srd-5.1');
  });

  it("comes from the played world's books, whatever the sheet's rules", async () => {
    state.campaigns = [{ format: 1, id: 'w', name: 'w', createdAt: 0, sources: ['dnd5e-2014/srd-5.1'], lastPlayed: 1 }];
    state.playing = 'w';
    expect(await opened('builtin:5e-2024-character')).toBe('srd-5.1');
  });
});
