import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignPlay } from '../../../src/app/campaigns/campaignPlay';
import { PartySync } from '../../../src/app/campaigns/partyValues/PartySync';
import { TABLE_CHARACTERS_PATH } from '../../../src/app/campaigns/partyValues/tableCharactersFile';
import { TableCharacters } from '../../../src/app/campaigns/partyValues/TableCharacters';
import type { TokenAsset } from '../../../src/app/services/AssetService';
import { createViewAtlasStore, type ViewAtlasStore } from '../../../src/app/storeFactory';
import type { Character } from '../../../src/app/types';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;
const campaignText = (id: string, name: string): string => `${JSON.stringify({ format: 1, id, name, createdAt: 1, lastPlayed: 1 })}\n`;
/** The table's characters file as #118 writes it: Mira's values, and a field of a later Atlas. */
const TABLE_FILE = `${JSON.stringify({ format: 1, characters: { mira: { resources: { hp: { current: 6, max: 20 }, stress: { current: 2, max: 6, maxByHand: true } }, future: 'kept' } } }, null, 2)}\n`;
const FILES: Record<string, string> = {
  [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild'),
  [`${MOOR}/campaign.json`]: campaignText('c2', 'Moor'),
  [TABLE_CHARACTERS_PATH]: TABLE_FILE,
};
const MIRA = { id: 'mira', name: 'Mira', imagePath: 'mira.png', collection: 'c', playerCharacter: true, createdAt: 1 } as TokenAsset;
const placed = (id: string, hp: number): Character => ({ id, kind: 'character', name: 'Mira', assetId: 'mira', imagePath: 'mira.png', x: 0, y: 0, resources: { hp: { current: hp, max: 20 } } });

const opened: ReturnType<typeof createInMemoryApp>[] = [];
const syncs: PartySync[] = [];

beforeEach(() => vi.stubGlobal('window', globalThis));

afterEach(() => {
  for (const sync of syncs.splice(0)) sync.destroy();
  for (const vault of opened.splice(0)) CampaignFiles.release(vault.app);
  vi.unstubAllGlobals();
});

async function open(files: Record<string, string> = FILES): Promise<{ vault: ReturnType<typeof createInMemoryApp>; sync: PartySync; play: CampaignPlay }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  const campaigns = CampaignFiles.open(vault.app);
  await campaigns.load();
  const characters = new TableCharacters(vault.app);
  const sync = new PartySync({ characters, tokens: () => [MIRA], ready: characters.load() });
  syncs.push(sync);
  await characters.load();
  return { vault, sync, play: CampaignPlay.forApp(vault.app) };
}

function scene(sync: PartySync, viewId: string, tokenId: string, hp: number): ViewAtlasStore {
  const { app } = createInMemoryApp();
  const store = createViewAtlasStore(app, viewId);
  store.setState({ persistenceEnabled: false, objects: { ...store.getState().objects, tokens: { [tokenId]: placed(tokenId, hp) } } });
  sync.registerStore(viewId, store);
  return store;
}

const hpOf = (store: ViewAtlasStore, tokenId: string): number | undefined => store.getState().objects.tokens[tokenId]?.resources?.hp?.current;

describe('the party values without a world', () => {
  it('are shared by every scene while no world is played', async () => {
    const { vault, sync, play } = await open();
    expect(play.playing()).toBeNull();
    const one = scene(sync, 'one', 'a', 20);
    const two = scene(sync, 'two', 'b', 20);
    // A token placed takes the values the vault keeps
    expect(hpOf(one, 'a')).toBe(6);
    expect(hpOf(two, 'b')).toBe(6);

    one.getState().updateTokens([{ id: 'a', changes: { resources: { hp: { current: 11, max: 20 } } } }]);
    expect(hpOf(two, 'b')).toBe(11);
    expect(sync.value('mira', 'hp')).toEqual({ current: 11, max: 20 });
    await sync.flush();
    expect(JSON.parse(vault.files.get(TABLE_CHARACTERS_PATH)!).characters.mira.resources.hp).toEqual({ current: 11, max: 20 });
  });

  it('stay the same when the world changes or goes during the session', async () => {
    const { sync, play } = await open();
    const store = scene(sync, 'one', 'a', 20);
    play.play('c1');
    expect(hpOf(store, 'a')).toBe(6);
    store.getState().updateTokens([{ id: 'a', changes: { resources: { hp: { current: 9, max: 20 } } } }]);
    play.play('c2');
    expect(hpOf(store, 'a')).toBe(9);
    expect(sync.value('mira', 'hp')).toEqual({ current: 9, max: 20 });
    play.stop();
    expect(hpOf(store, 'a')).toBe(9);
    expect(sync.setValue('mira', 'hp', { current: 4, max: 20 })).toBe(true);
    expect(hpOf(store, 'a')).toBe(4);
  });

  it('read a file written by #118 as it holds them, and leave it as it is', async () => {
    const { vault, sync } = await open();
    expect(sync.value('mira', 'hp')).toEqual({ current: 6, max: 20 });
    expect(sync.value('mira', 'stress')).toEqual({ current: 2, max: 6, maxByHand: true });
    await sync.flush();
    expect(vault.files.get(TABLE_CHARACTERS_PATH)).toBe(TABLE_FILE);
    // A value set and set back writes the file it was
    expect(sync.setValue('mira', 'hp', { current: 7, max: 20 })).toBe(true);
    await sync.flush();
    expect(sync.setValue('mira', 'hp', { current: 6, max: 20 })).toBe(true);
    await sync.flush();
    expect(JSON.parse(vault.files.get(TABLE_CHARACTERS_PATH)!)).toEqual(JSON.parse(TABLE_FILE));
  });
});
