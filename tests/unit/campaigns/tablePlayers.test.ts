import { afterEach, describe, expect, it } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { withLink, withPlayer } from '../../../src/app/campaigns/players/playersFile';
import { TABLE_PLAYERS_PATH } from '../../../src/app/campaigns/players/tablePlayersFile';
import { TablePlayers } from '../../../src/app/campaigns/players/TablePlayers';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;
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

const opened: ReturnType<typeof createInMemoryApp>[] = [];

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
