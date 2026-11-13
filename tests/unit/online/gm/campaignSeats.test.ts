import { TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignFiles } from '../../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGNS_FOLDER } from '../../../../src/app/campaigns/campaignPaths';
import { CampaignPlayers } from '../../../../src/app/campaigns/players/CampaignPlayers';
import { withPlayer, type CampaignPlayer } from '../../../../src/app/campaigns/players/playersFile';
import { TABLE_PLAYERS_PATH } from '../../../../src/app/campaigns/players/tablePlayersFile';
import { TablePlayers } from '../../../../src/app/campaigns/players/TablePlayers';
import { MAX_CAMPAIGN_PLAYERS } from '../../../../src/app/online/protocol/index.ts';
import { admitNewcomer, campaignLink, linkRefusal, refusalText, renewLink, TableSeats } from '../../../../src/app/online/gm/campaignSeats.ts';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  Notice: class {
    constructor(text: string) {
      notices.push(text);
    }
  },
}));

const FOLDER = `${CAMPAIGNS_FOLDER}/Witherwild`;
const campaignText = `${JSON.stringify({ format: 1, id: 'c1', name: 'Witherwild', createdAt: 1 })}\n`;
const ANA: CampaignPlayer = { id: 'a'.repeat(20), name: 'Ana', code: '000001', characters: ['lib-ana'] };
const NEW = { id: 'n'.repeat(20), name: 'Noor' };
/** A random source that draws these numbers in turn, then zeros. */
const seq = (...draws: number[]): (() => number) => () => draws.shift() ?? 0;

/** A player id for each number, in the relay's alphabet. */
const seatId = (index: number): string => `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`.padStart(20, 'z');

const opened: ReturnType<typeof createInMemoryApp>[] = [];

/** A vault with one campaign, its table's players file read as the plugin reads it. */
async function table(files: Record<string, string> = {}): Promise<{ vault: ReturnType<typeof createInMemoryApp>; players: TablePlayers; seats: TableSeats }> {
  const vault = createInMemoryApp({ files: { [`${FOLDER}/campaign.json`]: campaignText, ...files } });
  opened.push(vault);
  await CampaignFiles.open(vault.app).load();
  await CampaignPlayers.open(vault.app).whenLoaded();
  const players = TablePlayers.open(vault.app);
  await players.whenReady();
  return { vault, players, seats: new TableSeats(players) };
}

/** What the table's players file holds on disk once every write landed. */
async function onDisk(vault: ReturnType<typeof createInMemoryApp>, players: TablePlayers): Promise<{ link?: string; players?: Record<string, { addedAt?: number }> }> {
  await players.flush();
  return JSON.parse(vault.files.get(TABLE_PLAYERS_PATH) ?? '{}') as { link?: string; players?: Record<string, { addedAt?: number }> };
}

const LATER = `${JSON.stringify({ format: 2, players: {} })}\n`;

afterEach(() => {
  notices.length = 0;
  vi.restoreAllMocks();
  for (const vault of opened.splice(0)) {
    TablePlayers.release(vault.app);
    CampaignPlayers.release(vault.app);
    CampaignFiles.release(vault.app);
  }
});

describe('the seats of the table', () => {
  it('are its players file: the players, their codes as the relay is told them, and who plays which character', async () => {
    const { players, seats } = await table();
    players.change((stored) => withPlayer(stored, ANA));
    expect(seats.players()).toEqual([ANA]);
    expect(seats.seats()).toEqual([{ id: ANA.id, name: 'Ana', code: '000001' }]);
    expect(seats.codeOf(ANA.id)).toBe('000001');
    expect(seats.codeOf(NEW.id)).toBeNull();
    seats.setOwner('lib-bear', ANA.id);
    expect(players.roster().players[0]?.characters).toEqual(['lib-ana', 'lib-bear']);
  });

  it('tell the relay the ids a player had in the worlds before they were merged', async () => {
    const merged = { format: 1, players: { [ANA.id]: { name: 'Ana', code: '000001', characters: [] } }, migratedIds: { c1: { [ANA.id]: ANA.id }, c2: { [seatId(1)]: ANA.id, [seatId(0)]: ANA.id } } };
    const { seats } = await table({ [TABLE_PLAYERS_PATH]: JSON.stringify(merged) });
    expect(seats.seats()).toEqual([{ id: ANA.id, name: 'Ana', code: '000001', was: [seatId(0), seatId(1)] }]);
  });

  it('tell their listeners of every change of the file, another device\'s too', async () => {
    const { vault, players, seats } = await table();
    let heard = 0;
    seats.onChange(() => (heard += 1));
    players.change((stored) => withPlayer(stored, ANA));
    expect(heard).toBe(1);
    // Another device's write arrives as a change of the file.
    await players.flush();
    const file = JSON.parse(vault.files.get(TABLE_PLAYERS_PATH) ?? '{}') as { players: Record<string, object> };
    file.players[NEW.id] = { name: 'Noor', code: '000002', characters: [], addedAt: 2 };
    await vault.app.vault.adapter.write(TABLE_PLAYERS_PATH, JSON.stringify(file));
    vault.emit('modify', new TFile(TABLE_PLAYERS_PATH));
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toBe(2);
    expect(seats.players().map((player) => player.name)).toEqual(['Ana', 'Noor']);
  });
});

describe('a newcomer admitted to the table', () => {
  it('gets a code no other player has and that is not the join code', async () => {
    const { seats } = await table();
    seats.change((stored) => withPlayer(stored, ANA));
    // The first draws are Ana's code and the join code.
    const admitted = admitNewcomer(seats, NEW, '000002', seq(1, 2, 3));
    expect(admitted).toEqual({ id: NEW.id, name: 'Noor', code: '000003', characters: [] });
    expect(seats.players().map((player) => player.code)).toEqual(['000001', '000003']);
  });

  it('is refused once the table has as many players as it may', async () => {
    const { seats } = await table();
    seats.change((stored) => Array.from({ length: MAX_CAMPAIGN_PLAYERS }, (_, index) => index).reduce(
      (file, index) => withPlayer(file, { id: seatId(index), name: `P${index}`, code: String(index).padStart(6, '0'), characters: [] }), stored,
    ));
    expect(seats.players()).toHaveLength(MAX_CAMPAIGN_PLAYERS);
    expect(admitNewcomer(seats, NEW, '999999')).toBeNull();
    expect(seats.players()).toHaveLength(MAX_CAMPAIGN_PLAYERS);
    expect(refusalText(seats, 'Noor')).toBe('The table has no room for Noor.');
  });

  it('is refused, and nothing written, where the players file is of a later format', async () => {
    const { vault, players, seats } = await table({ [TABLE_PLAYERS_PATH]: LATER });
    expect(admitNewcomer(seats, NEW, '999999')).toBeNull();
    await players.flush();
    expect(vault.files.get(TABLE_PLAYERS_PATH)).toBe(LATER);
    expect(refusalText(seats, 'Noor')).toBe('The table\'s players file is from a newer Atlas.');
  });
});

describe('the table\'s link', () => {
  const withLinkText = `${JSON.stringify({ format: 1, link: 'k'.repeat(26), players: {} })}\n`;

  it('made anew is the same in memory and on disk', async () => {
    const { vault, players, seats } = await table({ [TABLE_PLAYERS_PATH]: withLinkText });
    expect(renewLink(seats)).toBe(true);
    const shown = seats.link();
    expect(shown).not.toBe('k'.repeat(26));
    expect((await onDisk(vault, players)).link).toBe(shown);
    expect(seats.link()).toBe(shown);
  });

  it('made where the vault has no players file yet is the one kept on disk', async () => {
    const { vault, players, seats } = await table();
    const link = campaignLink(seats);
    expect(link).toMatch(/^[a-z2-7]{26}$/);
    expect((await onDisk(vault, players)).link).toBe(link);
    expect(seats.link()).toBe(link);
  });

  it('is refused with the reason: the players file not ready yet, a newer file', async () => {
    const early = createInMemoryApp({ files: { [`${FOLDER}/campaign.json`]: campaignText } });
    opened.push(early);
    const loading = new TableSeats(TablePlayers.open(early.app));
    expect(campaignLink(loading)).toBeNull();
    expect(linkRefusal(loading)).toBe('The campaigns and the table\'s players are still loading. Try again in a moment.');
    expect(refusalText(loading, 'Noor')).toBe('The campaigns and the table\'s players are still loading. Try again in a moment.');

    const { seats: later } = await table({ [TABLE_PLAYERS_PATH]: LATER });
    expect(campaignLink(later)).toBeNull();
    expect(linkRefusal(later)).toBe('The table\'s players file is from a newer Atlas.');
  });
});

describe('what the seats write', () => {
  it('gives a newcomer the same added time in memory and on disk', async () => {
    const { vault, players, seats } = await table({ [TABLE_PLAYERS_PATH]: `${JSON.stringify({ format: 1, players: {} })}\n` });
    let clock = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));
    admitNewcomer(seats, NEW, '999999');
    const inMemory = (players.entries()[0]?.players as Record<string, { addedAt?: number }>)[NEW.id]?.addedAt;
    expect((await onDisk(vault, players)).players?.[NEW.id]?.addedAt).toBe(inMemory);
  });

  it('tell the GM when a character cannot be given in a players file from a newer Atlas', async () => {
    const { seats } = await table({ [TABLE_PLAYERS_PATH]: LATER });
    seats.setOwner('lib-bear', ANA.id);
    expect(notices).toEqual(['The table\'s players file is from a newer Atlas.']);
  });
});
