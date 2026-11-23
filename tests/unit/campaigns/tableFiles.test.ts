import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignPlay } from '../../../src/app/campaigns/campaignPlay';
import { PartySync } from '../../../src/app/campaigns/partyValues/PartySync';
import { TABLE_CHARACTERS_PATH, emptyTableCharacters } from '../../../src/app/campaigns/partyValues/tableCharactersFile';
import { TableCharacters } from '../../../src/app/campaigns/partyValues/TableCharacters';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { withLink, withPlayer } from '../../../src/app/campaigns/players/playersFile';
import { TABLE_PLAYERS_PATH, emptyTablePlayers } from '../../../src/app/campaigns/players/tablePlayersFile';
import { TablePlayers } from '../../../src/app/campaigns/players/TablePlayers';
import { readTokenAssignments, withPlayerTokens, withTokenOwners } from '../../../src/app/campaigns/players/tokenAssignments';
import { partyValuesOf, withPartyChanges, type PartyChanges } from '../../../src/app/campaigns/partyValues/charactersFile';
import { partyKey } from '../../../src/app/campaigns/partyValues/partyKeys';

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;

const opened: ReturnType<typeof createInMemoryApp>[] = [];

const ANA = 'a'.repeat(20);
const MAP = 'Scenes/Cave.atlasmap';

const value = { current: 1, max: 2 };
const changes = (entries: [string, string][]): PartyChanges => new Map(entries.map(([character, key]) => [partyKey(character, key), value]));
const characterCount = (stored: ReturnType<typeof emptyTableCharacters>): number => Object.keys(stored.characters as object).length;

describe('the table\'s characters', () => {
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
});

describe('the table\'s players', () => {
  const campaignText = (id: string, name: string, lastPlayed?: number): string => `${JSON.stringify({ format: 1, id, name, createdAt: 1, ...(lastPlayed !== undefined && { lastPlayed }) })}\n`;
  const ID = 'abcdefghijklmnopqrst';
  const MIRA = { id: ID, name: 'Mira', code: '123456', characters: ['tok1'] };

  /** Two worlds whose folders still hold the players files Atlas wrote before the table had one file for the vault. */
  const OLD_WORLDS: Record<string, string> = {
    [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild', 200),
    [`${MOOR}/campaign.json`]: campaignText('c2', 'Moor', 100),
    [`${WITHERWILD}/players.json`]: `${JSON.stringify({ format: 1, campaignId: 'c1', link: 'w'.repeat(26), players: { [ID]: { name: 'Mira', code: '123456', characters: ['tok1'], addedAt: 20 } }, tokenOwners: { 'gm-1': ID } }, null, 2)}\n`,
    [`${MOOR}/players.json`]: `${JSON.stringify({ format: 1, campaignId: 'c2', link: 'm'.repeat(26), players: { ['m'.repeat(20)]: { name: 'mira', code: '654321', characters: ['tok2'], addedAt: 10 } } }, null, 2)}\n`,
  };

  /** A device as the plugin starts it: campaigns, then the table's players file. */
  async function device(files: Record<string, string> = { [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild') }): Promise<{ vault: ReturnType<typeof createInMemoryApp>; players: TablePlayers }> {
    const vault = createInMemoryApp({ files });
    opened.push(vault);
    await CampaignFiles.open(vault.app).load();
    const players = TablePlayers.open(vault.app);
    await players.load();
    await players.flush();
    return { vault, players };
  }

  afterEach(() => {
    for (const vault of opened.splice(0)) {
      TablePlayers.release(vault.app);
      CampaignFiles.release(vault.app);
    }
  });

  describe('the table\'s players file', () => {
    it('lies in the worlds\' folder, in no world, and is no compendium players file', () => {
      expect(TABLE_PLAYERS_PATH).toBe(`${CAMPAIGNS_FOLDER}/players.json`);
      expect(TABLE_PLAYERS_PATH).not.toBe('atlas-vtt/players.json');
      expect(TABLE_PLAYERS_PATH.split('/').some((part) => part.startsWith('.') || part.startsWith('_'))).toBe(false);
    });

    it('is created when a change finds none, whatever world is played', async () => {
      const { vault, players } = await device();
      expect(players.roster()).toEqual({ link: null, players: [], writable: true });
      expect(players.change((stored) => withPlayer(stored, MIRA, 5))).toBe(true);
      await players.flush();
      const written = JSON.parse(vault.files.get(TABLE_PLAYERS_PATH)!) as Record<string, unknown>;
      expect(written).toMatchObject({ format: 1, players: { [ID]: { name: 'Mira', code: '123456', characters: ['tok1'], addedAt: 5 } } });
      expect(written).not.toHaveProperty('id');
      expect(written).not.toHaveProperty('campaignId');
      expect(players.roster().players).toEqual([MIRA]);
    });

    it('is changed where it is, keeping what it holds and fields Atlas does not know', async () => {
      const { vault, players } = await device({ [TABLE_PLAYERS_PATH]: `${JSON.stringify({ format: 1, players: {}, future: 'kept' })}\n` });
      players.change((stored) => withLink(stored, 'a'.repeat(26)));
      players.change((stored) => withPlayer(stored, MIRA, 5));
      await players.flush();
      expect(JSON.parse(vault.files.get(TABLE_PLAYERS_PATH)!)).toMatchObject({ link: 'a'.repeat(26), future: 'kept', players: { [ID]: { name: 'Mira' } } });
      expect(players.roster().link).toBe('a'.repeat(26));
    });

    it('of a later format is read and never written', async () => {
      const later = `${JSON.stringify({ format: 2, players: {} })}\n`;
      const { vault, players } = await device({ [TABLE_PLAYERS_PATH]: later });
      expect(players.roster().writable).toBe(false);
      expect(players.blocked()).toBe('newer');
      expect(players.change((stored) => withPlayer(stored, MIRA))).toBe(false);
      await players.flush();
      expect(vault.files.get(TABLE_PLAYERS_PATH)).toBe(later);
    });

    it('cannot be changed before it is read', () => {
      const vault = createInMemoryApp({ files: {} });
      opened.push(vault);
      const players = TablePlayers.open(vault.app);
      expect(players.blocked()).toBe('loading');
      expect(players.change((stored) => withPlayer(stored, MIRA))).toBe(false);
    });
  });

  describe('a vault with players files from before the table\'s file', () => {
    it('starts with an empty table, reads none of them and writes nothing until a change', async () => {
      const { vault, players } = await device(OLD_WORLDS);
      expect(players.roster()).toEqual({ link: null, players: [], writable: true });
      expect(players.assignments().owners).toEqual({});
      expect(players.blocked()).toBeNull();
      expect(vault.files.has(TABLE_PLAYERS_PATH)).toBe(false);
      expect(vault.files.get(`${WITHERWILD}/players.json`)).toBe(OLD_WORLDS[`${WITHERWILD}/players.json`]);
      expect(players.change((stored) => withPlayer(stored, MIRA, 5))).toBe(true);
      await players.flush();
      expect(JSON.parse(vault.files.get(TABLE_PLAYERS_PATH)!)).toEqual({ format: 1, players: { [ID]: { name: 'Mira', code: '123456', characters: ['tok1'], addedAt: 5 } } });
    });
  });
});

describe('the tokens the table\'s players file assigns', () => {
  it('are written beside the players, who stay as they were, and an empty field is left out', () => {
    const file = withPlayer(emptyTablePlayers(), { id: ANA, name: 'Ana', code: '123456', characters: ['hero'] }, 1);
    const given = withPlayerTokens(withTokenOwners(file, ['gm-1', 'gm-2'], ANA), MAP, ['gm-1'], true);
    expect(given).toMatchObject({ players: file.players, tokenOwners: { 'gm-1': ANA, 'gm-2': ANA }, playerTokens: { [MAP]: { 'gm-1': true } } });
    const taken = withTokenOwners(given, ['gm-1', 'gm-2'], null);
    expect(taken).not.toHaveProperty('tokenOwners');
    expect(readTokenAssignments(taken)).toEqual({ owners: {}, playerTokens: { [MAP]: { 'gm-1': true } } });
  });

  it('are read only where they can be trusted', () => {
    const file = {
      ...emptyTablePlayers(),
      tokenOwners: { 'gm-1': ANA, 'gm-2': 'nobody', 'gm-3': 7, ['x'.repeat(300)]: ANA },
      playerTokens: { [MAP]: { 'gm-1': true, 'gm-2': 'yes', ['x'.repeat(300)]: true }, 'Scenes/Empty.atlasmap': { 'gm-3': 1 }, ['p'.repeat(1001)]: { 'gm-4': true }, 'Scenes/Bad.atlasmap': [] },
    };
    expect(readTokenAssignments(file)).toEqual({ owners: { 'gm-1': ANA }, playerTokens: { [MAP]: { 'gm-1': true } } });
    expect(readTokenAssignments({ ...emptyTablePlayers(), tokenOwners: 'garbage', playerTokens: 3 })).toEqual({ owners: {}, playerTokens: {} });
  });

  it('are never written into a file of a later format', () => {
    const newer = { ...emptyTablePlayers(), format: 99 };
    expect(withTokenOwners(newer, ['gm-1'], ANA)).toBe(newer);
    expect(withPlayerTokens(newer, MAP, ['gm-1'], true)).toBe(newer);
  });
});

describe('the table\'s characters file is written within what it is read with', () => {
  it('takes no character past the 500th, and still changes those it has', () => {
    const full = withPartyChanges(emptyTableCharacters(), changes(Array.from({ length: 500 }, (_, i) => [`tok${i}`, 'hp'])));
    expect(characterCount(full)).toBe(500);
    const next = withPartyChanges(full, new Map([[partyKey('tok500', 'hp'), value], [partyKey('tok0', 'hp'), { current: 2, max: 2 }]]));
    expect(characterCount(next)).toBe(500);
    expect(partyValuesOf(next)[partyKey('tok0', 'hp')]).toEqual({ current: 2, max: 2 });
  });

  it('takes no value past the 200th of a character', () => {
    const full = withPartyChanges(emptyTableCharacters(), changes(Array.from({ length: 201 }, (_, i) => ['tok1', `r${i}`])));
    expect(Object.keys(partyValuesOf(full))).toHaveLength(200);
    expect(partyValuesOf(full)[partyKey('tok1', 'r200')]).toBeUndefined();
  });

  it('takes no key that is empty or too long, and removes no character it does not have', () => {
    const next = withPartyChanges(emptyTableCharacters(), new Map([
      [partyKey('', 'hp'), value],
      [partyKey('tok1', 'x'.repeat(201)), value],
      [partyKey('tok2', 'hp'), undefined],
    ]));
    expect(next.characters).toEqual({});
  });
});
