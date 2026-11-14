import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignPlay } from '../../../src/app/campaigns/campaignPlay';
import { PartySync } from '../../../src/app/campaigns/partyValues/PartySync';
import { TABLE_CHARACTERS_PATH } from '../../../src/app/campaigns/partyValues/tableCharactersFile';
import { TableCharacters } from '../../../src/app/campaigns/partyValues/TableCharacters';
import { characterRestOf } from '../../../src/app/recovery/characterRest';
import type { RestOutcome } from '../../../src/app/recovery/restTypes';
import { writeRest } from '../../../src/app/recovery/restWrites';
import type { TokenAsset } from '../../../src/app/services/AssetService';
import { TEMPLATE_FORMAT, type StatblockTemplate } from '../../../src/app/statblocks/model/templateTypes';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const HP = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#cc3333', visibleToPlayers: true };
vi.mock('../../../src/app/services/AssetService', () => ({
  AssetService: { getInstance: () => ({ getCollectionSettings: () => ({ resources: [HP] }), loadedTokenAssets: () => [] }) },
}));
vi.mock('../../../src/app/services/collectionScenes', () => ({ openMapViews: () => [] }));

const MIRA = { id: 'mira', name: 'Mira', imagePath: 'mira.png', collection: 'c', playerCharacter: true, createdAt: 1 } as TokenAsset;
const TEMPLATE: StatblockTemplate = { format: TEMPLATE_FORMAT, version: 1, id: 'rest-abc123', fields: [], layout: { maxColumns: 1, columnWidth: 22, blocks: [] } };
const FILES = {
  [`${CAMPAIGNS_FOLDER}/Moor/campaign.json`]: `${JSON.stringify({ format: 1, id: 'c2', name: 'Moor', createdAt: 1, lastPlayed: 1 })}\n`,
  [TABLE_CHARACTERS_PATH]: `${JSON.stringify({ format: 1, characters: { mira: { resources: { hp: { current: 3, max: 20 } } } } })}\n`,
};

const opened: ReturnType<typeof createInMemoryApp>[] = [];

beforeEach(() => vi.stubGlobal('window', globalThis));

afterEach(() => {
  for (const vault of opened.splice(0)) {
    PartySync.release(vault.app);
    CampaignFiles.release(vault.app);
  }
  vi.unstubAllGlobals();
});

describe('a rest without a world played', () => {
  it('reads and writes the values the vault keeps of the character', async () => {
    const vault = createInMemoryApp({ files: FILES });
    opened.push(vault);
    const campaigns = CampaignFiles.open(vault.app);
    await campaigns.load();
    const characters = new TableCharacters(vault.app, campaigns);
    const sync = new PartySync({ characters, tokens: () => [MIRA], ready: characters.whenReady() });
    PartySync.register(vault.app, sync);
    await characters.whenReady();
    expect(CampaignPlay.forApp(vault.app).playing()).toBeNull();

    const rest = characterRestOf(vault.app, MIRA, { notePath: 'Mira.md', templateId: TEMPLATE.id, template: TEMPLATE, record: {} });
    expect(rest.character.resourceValue('hp')).toEqual({ current: 3, max: 20 });
    expect(rest.resourcePlace('hp')).toEqual({ kind: 'party' });

    const outcome: RestOutcome = { changes: [], skipped: [], byCharacter: new Map([['mira', { resources: new Map([['hp', { current: 20, max: 20 }]]), counters: new Map(), conditions: new Map() }]]) };
    expect(await writeRest(vault.app, rest, outcome, async () => null)).toBeNull();
    expect(sync.value('mira', 'hp')).toEqual({ current: 20, max: 20 });
    await sync.flush();
    expect(JSON.parse(vault.files.get(TABLE_CHARACTERS_PATH)!).characters.mira.resources.hp).toEqual({ current: 20, max: 20 });
  });
});
