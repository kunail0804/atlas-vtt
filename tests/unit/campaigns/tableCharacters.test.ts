import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignPlay } from '../../../src/app/campaigns/campaignPlay';
import { PartySync } from '../../../src/app/campaigns/partyValues/PartySync';
import { TABLE_CHARACTERS_PATH } from '../../../src/app/campaigns/partyValues/tableCharactersFile';
import { TableCharacters } from '../../../src/app/campaigns/partyValues/TableCharacters';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;
const campaignText = (id: string, name: string, lastPlayed: number): string => `${JSON.stringify({ format: 1, id, name, createdAt: 1, lastPlayed })}\n`;
const hp = (current: number, max = 10): { resources: { hp: { current: number; max: number } } } => ({ resources: { hp: { current, max } } });
const charactersText = (campaignId: string, characters: Record<string, unknown>): string => `${JSON.stringify({ format: 1, campaignId, characters }, null, 2)}\n`;

/** Two worlds whose folders still hold the characters files Atlas wrote before the table had one file for the vault. */
const OLD_WORLDS: Record<string, string> = {
  [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild', 200),
  [`${MOOR}/campaign.json`]: campaignText('c2', 'Moor', 100),
  [`${WITHERWILD}/characters.json`]: charactersText('c1', { tok1: { resources: { hp: { current: 3, max: 10 } }, future: 'kept' } }),
  [`${MOOR}/characters.json`]: charactersText('c2', { tok1: { resources: { hp: { current: 9, max: 10 }, stress: { current: 1, max: 6 } } }, tok2: hp(5) }),
};

const opened: ReturnType<typeof createInMemoryApp>[] = [];
const syncs: PartySync[] = [];

async function device(files: Record<string, string>): Promise<{ vault: ReturnType<typeof createInMemoryApp>; characters: TableCharacters; campaigns: CampaignFiles }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  const campaigns = CampaignFiles.open(vault.app);
  await campaigns.load();
  const characters = new TableCharacters(vault.app);
  await characters.load();
  await characters.flush();
  return { vault, characters, campaigns };
}

beforeEach(() => vi.stubGlobal('window', globalThis));

afterEach(() => {
  for (const sync of syncs.splice(0)) sync.destroy();
  for (const vault of opened.splice(0)) CampaignFiles.release(vault.app);
  vi.unstubAllGlobals();
});

describe('the table\'s characters file', () => {
  it('lies in the worlds\' folder, in none of them', () => {
    expect(TABLE_CHARACTERS_PATH).toBe(`${CAMPAIGNS_FOLDER}/characters.json`);
  });

  it('starts empty on a vault whose worlds hold characters files from before it, which it never reads', async () => {
    const { vault, characters } = await device(OLD_WORLDS);
    expect(characters.stored()).toBeUndefined();
    expect(vault.files.has(TABLE_CHARACTERS_PATH)).toBe(false);
    for (const [path, text] of Object.entries(OLD_WORLDS)) expect(vault.files.get(path)).toBe(text);
  });

  it('a file the vault has stays as it is, even one that cannot be read', async () => {
    const held = `${JSON.stringify({ format: 1, characters: { tok9: hp(1) } })}\n`;
    expect((await device({ ...OLD_WORLDS, [TABLE_CHARACTERS_PATH]: held })).vault.files.get(TABLE_CHARACTERS_PATH)).toBe(held);
    expect((await device({ ...OLD_WORLDS, [TABLE_CHARACTERS_PATH]: '{ nope' })).vault.files.get(TABLE_CHARACTERS_PATH)).toBe('{ nope');
  });

  it('is what the party sync reads and writes, whatever world is played', async () => {
    const held = `${JSON.stringify({ format: 1, characters: { tok1: { resources: { hp: { current: 3, max: 10 } }, future: 'kept' }, tok2: hp(5) } })}\n`;
    const { vault, characters } = await device({ ...OLD_WORLDS, [TABLE_CHARACTERS_PATH]: held });
    const play = CampaignPlay.forApp(vault.app);
    const sync = new PartySync({ characters, tokens: () => [], ready: characters.load() });
    syncs.push(sync);
    await characters.load();
    expect(sync.value('tok2', 'hp')).toEqual({ current: 5, max: 10 });
    expect(sync.value('tok1', 'hp')).toEqual({ current: 3, max: 10 });

    play.play('c2');
    expect(sync.setValue('tok1', 'hp', { current: 7, max: 10 })).toBe(true);
    await sync.flush();
    expect(sync.value('tok1', 'hp')).toEqual({ current: 7, max: 10 });
    expect(JSON.parse(vault.files.get(TABLE_CHARACTERS_PATH)!).characters.tok1).toEqual({ resources: { hp: { current: 7, max: 10 } }, future: 'kept' });
    expect(vault.files.get(`${MOOR}/characters.json`)).toBe(OLD_WORLDS[`${MOOR}/characters.json`]);
  });

  it('of a later format is read and never written', async () => {
    const later = `${JSON.stringify({ format: 2, characters: { tok1: hp(4) } })}\n`;
    const { vault, characters } = await device({ ...OLD_WORLDS, [TABLE_CHARACTERS_PATH]: later });
    const sync = new PartySync({ characters, tokens: () => [], ready: characters.load() });
    syncs.push(sync);
    await characters.load();
    expect(sync.value('tok1', 'hp')).toEqual({ current: 4, max: 10 });
    expect(sync.setValue('tok1', 'hp', hp(1).resources.hp)).toBe(false);
    await sync.flush();
    expect(vault.files.get(TABLE_CHARACTERS_PATH)).toBe(later);
  });
});
