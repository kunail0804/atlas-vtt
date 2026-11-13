import { afterEach, describe, expect, it } from 'vitest';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignPlayers } from '../../../src/app/campaigns/players/CampaignPlayers';
import { withLink, withPlayer } from '../../../src/app/campaigns/players/playersFile';
import { TABLE_PLAYERS_PATH } from '../../../src/app/campaigns/players/tablePlayersFile';
import { TablePlayers } from '../../../src/app/campaigns/players/TablePlayers';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const WITHERWILD = `${CAMPAIGNS_FOLDER}/Witherwild`;
const MOOR = `${CAMPAIGNS_FOLDER}/Moor`;
const campaignText = (id: string, name: string, lastPlayed?: number): string => `${JSON.stringify({ format: 1, id, name, createdAt: 1, ...(lastPlayed !== undefined && { lastPlayed }) })}\n`;
const ID = 'abcdefghijklmnopqrst';
const MIRA = { id: ID, name: 'Mira', code: '123456', characters: ['tok1'] };

/** Two worlds that both had Mira (added first in the Moor, under another id) and the Witherwild played last. */
const WORLDS: Record<string, string> = {
  [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild', 200),
  [`${MOOR}/campaign.json`]: campaignText('c2', 'Moor', 100),
  [`${WITHERWILD}/players.json`]: `${JSON.stringify({ format: 1, campaignId: 'c1', link: 'w'.repeat(26), players: { [ID]: { name: 'Mira', code: '123456', characters: ['tok1'], addedAt: 20 } }, tokenOwners: { 'gm-1': ID } }, null, 2)}\n`,
  [`${MOOR}/players.json`]: `${JSON.stringify({ format: 1, campaignId: 'c2', link: 'm'.repeat(26), players: { ['m'.repeat(20)]: { name: 'mira', code: '654321', characters: ['tok2'], addedAt: 10 } } }, null, 2)}\n`,
};

const opened: ReturnType<typeof createInMemoryApp>[] = [];

/** A device as the plugin starts it: campaigns, then their players files, then the table's. */
async function device(files: Record<string, string> = { [`${WITHERWILD}/campaign.json`]: campaignText('c1', 'Witherwild') }): Promise<{ vault: ReturnType<typeof createInMemoryApp>; players: TablePlayers }> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  await CampaignPlayers.open(vault.app).whenLoaded();
  const players = TablePlayers.open(vault.app);
  await players.whenReady();
  await players.flush();
  return { vault, players };
}

afterEach(() => {
  for (const vault of opened.splice(0)) {
    TablePlayers.release(vault.app);
    CampaignPlayers.release(vault.app);
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

  it('cannot be changed before it is ready', () => {
    const vault = createInMemoryApp({ files: {} });
    opened.push(vault);
    const players = TablePlayers.open(vault.app);
    expect(players.blocked()).toBe('loading');
    expect(players.change((stored) => withPlayer(stored, MIRA))).toBe(false);
  });
});

describe('carrying the worlds\' players into the table\'s file', () => {
  it('merges them once, leaving the worlds\' files as they were', async () => {
    const { vault, players } = await device(WORLDS);
    // Mira of the Moor was added first: her id and code stay, and she plays both worlds' characters.
    const mira = 'm'.repeat(20);
    expect(players.roster()).toEqual({ link: 'w'.repeat(26), players: [{ id: mira, name: 'mira', code: '654321', characters: ['tok1', 'tok2'] }], writable: true });
    expect(players.migratedIds()).toEqual({ c1: { [ID]: mira }, c2: { [mira]: mira } });
    expect(players.assignments().owners).toEqual({ 'gm-1': mira });
    expect(vault.files.get(`${WITHERWILD}/players.json`)).toBe(WORLDS[`${WITHERWILD}/players.json`]);
    expect(vault.files.get(`${MOOR}/players.json`)).toBe(WORLDS[`${MOOR}/players.json`]);
  });

  it('writes the same file on two devices that migrate at once', async () => {
    const first = await device(WORLDS);
    const second = await device(WORLDS);
    expect(first.vault.files.get(TABLE_PLAYERS_PATH)).toBeDefined();
    expect(second.vault.files.get(TABLE_PLAYERS_PATH)).toBe(first.vault.files.get(TABLE_PLAYERS_PATH));
  });

  it('leaves a table file the vault already has as it is, even one that cannot be read', async () => {
    const kept = `${JSON.stringify({ format: 1, players: {} })}\n`;
    const { vault, players } = await device({ ...WORLDS, [TABLE_PLAYERS_PATH]: kept });
    expect(vault.files.get(TABLE_PLAYERS_PATH)).toBe(kept);
    expect(players.roster().players).toEqual([]);
    const broken = await device({ ...WORLDS, [TABLE_PLAYERS_PATH]: '{ not json' });
    expect(broken.vault.files.get(TABLE_PLAYERS_PATH)).toBe('{ not json');
  });

  it('writes nothing where no world had players', async () => {
    const { vault } = await device();
    expect(vault.files.has(TABLE_PLAYERS_PATH)).toBe(false);
  });
});
