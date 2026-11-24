import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type Plugin } from 'obsidian';
import { CampaignFiles } from '../../../src/app/campaigns/CampaignFiles';
import { CAMPAIGN_LAYOUT, CAMPAIGNS_FOLDER } from '../../../src/app/campaigns/campaignPaths';
import { CampaignService } from '../../../src/app/campaigns/CampaignService';
import { PartySync } from '../../../src/app/campaigns/partyValues/PartySync';
import { partyKey } from '../../../src/app/campaigns/partyValues/partyKeys';
import { TABLE_CHARACTERS_PATH } from '../../../src/app/campaigns/partyValues/tableCharactersFile';
import { TableCharacters } from '../../../src/app/campaigns/partyValues/TableCharacters';
import { withBook } from '../../../src/app/campaigns/players/booksFile';
import { withPlayer } from '../../../src/app/campaigns/players/playersFile';
import { TABLE_BOOKS_PATH } from '../../../src/app/campaigns/players/tableBooksFile';
import { TableBooks } from '../../../src/app/campaigns/players/TableBooks';
import { TABLE_PLAYERS_PATH } from '../../../src/app/campaigns/players/tablePlayersFile';
import { TablePlayers } from '../../../src/app/campaigns/players/TablePlayers';
import { UNREADABLE_WARNING_MS, warnWhenUnreadable } from '../../../src/app/campaigns/tableFileWarning';
import { TableSeats } from '../../../src/app/online/gm/campaignSeats.ts';
import { TableRoster } from '../../../src/app/online/gm/tableRoster.ts';
import { EMPTY_BOOK, type StoredBook } from '../../../src/app/online/gm/book/bookStore';
import { registerPartySync } from '../../../src/app/plugin/partySync';
import { showNotice } from '../../../src/app/ui/notice';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { fileHandle } from '../../mocks/obsidianHandles';

vi.mock('../../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));
vi.mock('../../../src/app/services/AssetService', () => ({
  AssetService: { getInstance: () => ({ loadedTokenAssets: () => [], initialize: () => Promise.resolve() }) },
}));

const MIRA = { id: 'm'.repeat(20), name: 'Mira', code: '123456', characters: [] };
const NOOR = { id: 'n'.repeat(20), name: 'Noor', code: '654321', characters: [] };
const playersText = (players: readonly (typeof MIRA)[]): string =>
  `${JSON.stringify({ format: 1, players: Object.fromEntries(players.map(({ id, ...rest }) => [id, { ...rest, addedAt: 1 }])) }, null, 2)}\n`;
const charactersText = `${JSON.stringify({ format: 1, characters: { tok1: { resources: { hp: { current: 3, max: 10 } } } } }, null, 2)}\n`;
const book: StoredBook = { ...EMPTY_BOOK, notes: [{ id: '1'.padStart(24, '0'), title: 'Le moulin', body: 'Le passage sous le moulin', at: 1 }] };
const booksText = `${JSON.stringify({ format: 1, books: { tok1: book } }, null, 2)}\n`;
const HP = partyKey('tok1', 'hp');

const opened: ReturnType<typeof createInMemoryApp>[] = [];
const ticks = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function vaultWith(files: Record<string, string>): ReturnType<typeof createInMemoryApp> {
  const vault = createInMemoryApp({ files });
  opened.push(vault);
  return vault;
}

/** What a sync tool does that writes the file in two steps: half of it first, the vault told. */
async function halfWritten(vault: ReturnType<typeof createInMemoryApp>, path: string): Promise<void> {
  vault.files.set(path, vault.files.get(path)!.slice(0, 20));
  vault.emit('modify', fileHandle(path));
  await ticks();
}

async function mended(vault: ReturnType<typeof createInMemoryApp>, path: string, text: string): Promise<void> {
  vault.files.set(path, text);
  vault.emit('modify', fileHandle(path));
  await ticks();
}

async function tablePlayers(files: Record<string, string>): Promise<{ vault: ReturnType<typeof createInMemoryApp>; players: TablePlayers }> {
  const vault = vaultWith(files);
  await CampaignFiles.open(vault.app).load();
  const players = TablePlayers.open(vault.app);
  await players.load();
  return { vault, players };
}

beforeEach(() => vi.stubGlobal('window', globalThis));

afterEach(() => {
  for (const vault of opened.splice(0)) {
    PartySync.release(vault.app);
    TablePlayers.release(vault.app);
    TableBooks.release(vault.app);
    CampaignFiles.release(vault.app);
  }
  vi.mocked(showNotice).mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('an unreadable players file', () => {
  it('refuses changes where it was never read, and the disk keeps its text', async () => {
    const broken = '{ "format": 1, "players": { "abc": ';
    const { vault, players } = await tablePlayers({ [TABLE_PLAYERS_PATH]: broken });
    expect(players.blocked()).toBe('unreadable');
    expect(players.change((stored) => withPlayer(stored, MIRA, 5))).toBe(false);
    await players.flush();
    expect(vault.files.get(TABLE_PLAYERS_PATH)).toBe(broken);
  });

  it('keeps the players read last while it cannot be read, and takes changes again once it can', async () => {
    const good = playersText([MIRA]);
    const { vault, players } = await tablePlayers({ [TABLE_PLAYERS_PATH]: good });
    await halfWritten(vault, TABLE_PLAYERS_PATH);
    expect(players.roster().players.map((player) => player.name)).toEqual(['Mira']);
    expect(players.blocked()).toBe('unreadable');
    expect(players.change((stored) => withPlayer(stored, NOOR, 5))).toBe(false);

    await mended(vault, TABLE_PLAYERS_PATH, good);
    expect(players.blocked()).toBeNull();
    expect(players.change((stored) => withPlayer(stored, NOOR, 5))).toBe(true);
    await players.flush();
    expect(players.roster().players.map((player) => player.name)).toEqual(['Mira', 'Noor']);
  });

  it('tells the GM why a change was refused', async () => {
    const { vault, players } = await tablePlayers({ [TABLE_PLAYERS_PATH]: playersText([MIRA]) });
    await halfWritten(vault, TABLE_PLAYERS_PATH);
    const seats = new TableSeats(players);
    expect(seats.refusal()).toContain(TABLE_PLAYERS_PATH);
    seats.setOwner('tok1', MIRA.id);
    expect(showNotice).toHaveBeenCalledWith(seats.refusal());
  });
});

describe('a running table whose players file turns unreadable', () => {
  it('tells the relay no empty table, and lets a player who reconnects then back in', async () => {
    const { vault, players } = await tablePlayers({ [TABLE_PLAYERS_PATH]: playersText([MIRA]) });
    const rosters: number[] = [];
    const kicked: string[] = [];
    const roster = new TableRoster(new TableSeats(players), { setPlayers: (seats) => void rosters.push(seats.length), sendCode: () => undefined },
      { kick: (id) => void kicked.push(id), turnAway: (id) => void kicked.push(`away:${id}`), joinCode: () => '100001' });
    roster.start();
    await halfWritten(vault, TABLE_PLAYERS_PATH);
    expect(roster.joined({ id: MIRA.id, name: 'Mira' })).toBe(true);
    expect(rosters).toEqual([1]);
    expect(kicked).toEqual([]);
    roster.dispose();
  });

  it('tells the relay nothing while the file was never read, and the players once it is', async () => {
    const { vault, players } = await tablePlayers({ [TABLE_PLAYERS_PATH]: '{ truncated' });
    const rosters: number[] = [];
    const roster = new TableRoster(new TableSeats(players), { setPlayers: (seats) => void rosters.push(seats.length), sendCode: () => undefined },
      { kick: () => undefined, turnAway: () => undefined, joinCode: () => '100001' });
    roster.start();
    expect(rosters).toEqual([]);
    await mended(vault, TABLE_PLAYERS_PATH, playersText([MIRA]));
    expect(rosters).toEqual([1]);
    roster.dispose();
  });
});

describe('an unreadable books file', () => {
  it('keeps the books read last and refuses changes until it can be read', async () => {
    const vault = vaultWith({ [TABLE_BOOKS_PATH]: booksText });
    const books = TableBooks.open(vault.app);
    await books.load();
    await halfWritten(vault, TABLE_BOOKS_PATH);
    expect(books.of('tok1')).toEqual(book);
    expect(books.canChange()).toBe(false);
    expect(books.change((stored) => withBook(stored, 'tok1', EMPTY_BOOK))).toBe(false);
    await mended(vault, TABLE_BOOKS_PATH, booksText);
    expect(books.canChange()).toBe(true);
  });
});

describe('an unreadable characters file', () => {
  async function party(text: string): Promise<{ vault: ReturnType<typeof createInMemoryApp>; characters: TableCharacters; sync: PartySync }> {
    const vault = vaultWith({ [TABLE_CHARACTERS_PATH]: text });
    const characters = new TableCharacters(vault.app);
    await characters.load();
    const sync = new PartySync({ characters, tokens: () => [], ready: Promise.resolve() });
    PartySync.register(vault.app, sync);
    await ticks();
    return { vault, characters, sync };
  }

  it('keeps the values read last, and the party values are not kept while it cannot be read', async () => {
    const { vault, characters, sync } = await party(charactersText);
    expect(sync.isKeeping()).toBe(true);
    await halfWritten(vault, TABLE_CHARACTERS_PATH);
    expect(characters.blocked()).toBe('unreadable');
    expect(sync.isKeeping()).toBe(false);
    expect(sync.value('tok1', 'hp')).toEqual({ current: 3, max: 10 });
    expect(sync.setValue('tok1', 'hp', { current: 1, max: 10 })).toBe(false);
    expect(characters.write(new Map([[HP, { current: 1, max: 10 }]]))).toBe(false);

    await mended(vault, TABLE_CHARACTERS_PATH, charactersText);
    expect(sync.isKeeping()).toBe(true);
  });

  it('writes a change it could not write while the file was unreadable once it can be read again', async () => {
    const { vault, sync } = await party(charactersText);
    expect(sync.setValue('tok1', 'hp', { current: 7, max: 10 })).toBe(true);
    await halfWritten(vault, TABLE_CHARACTERS_PATH);
    await sync.flush();
    expect(vault.files.get(TABLE_CHARACTERS_PATH)!.length).toBe(20);

    await mended(vault, TABLE_CHARACTERS_PATH, charactersText);
    expect(sync.value('tok1', 'hp')).toEqual({ current: 7, max: 10 });
    await sync.flush();
    expect(JSON.parse(vault.files.get(TABLE_CHARACTERS_PATH)!)).toMatchObject({ characters: { tok1: { resources: { hp: { current: 7, max: 10 } } } } });
  });
});

describe('the warning about an unreadable table file', () => {
  it('tells the GM once when the file stays unreadable, and not for a write that mends it at once', async () => {
    vi.useFakeTimers();
    const vault = vaultWith({ [TABLE_BOOKS_PATH]: booksText });
    const books = TableBooks.open(vault.app);
    await books.load();
    const stop = warnWhenUnreadable(books);

    await halfWritten(vault, TABLE_BOOKS_PATH);
    await mended(vault, TABLE_BOOKS_PATH, booksText);
    vi.advanceTimersByTime(UNREADABLE_WARNING_MS);
    expect(showNotice).not.toHaveBeenCalled();

    await halfWritten(vault, TABLE_BOOKS_PATH);
    vi.advanceTimersByTime(UNREADABLE_WARNING_MS);
    expect(showNotice).toHaveBeenCalledOnce();
    expect(vi.mocked(showNotice).mock.calls[0]?.[0]).toContain(TABLE_BOOKS_PATH);
    vault.emit('modify', fileHandle(TABLE_BOOKS_PATH));
    await ticks();
    vi.advanceTimersByTime(UNREADABLE_WARNING_MS);
    expect(showNotice).toHaveBeenCalledOnce();
    stop();
  });
});

describe('the names of the table\'s files', () => {
  it('name no world', async () => {
    const vault = vaultWith({});
    const files = CampaignFiles.open(vault.app);
    await files.load();
    const service = new CampaignService(files);
    for (const name of ['players.json', 'Books.JSON', ' characters.json ']) expect(service.nameError(name)).not.toBeNull();
    expect(service.nameError('players')).toBeNull();
  });

  it('are never the folder of a world', () => {
    const free = CAMPAIGN_LAYOUT.freeNamedPath('players.json', () => false);
    expect(free).not.toBe(TABLE_PLAYERS_PATH);
    expect(free.startsWith(`${CAMPAIGNS_FOLDER}/`)).toBe(true);
    expect(CAMPAIGN_LAYOUT.freeNamedPath('Witherwild', () => false)).toBe(`${CAMPAIGNS_FOLDER}/Witherwild`);
  });
});

describe('registerPartySync', () => {
  it('keeps the party values even when reading the worlds failed', async () => {
    const vault = vaultWith({ [TABLE_CHARACTERS_PATH]: charactersText });
    const cleanups: (() => void)[] = [];
    const plugin = { app: vault.app, registerEvent: () => undefined, register: (cleanup: () => void) => void cleanups.push(cleanup) } as unknown as Plugin;
    registerPartySync(plugin, Promise.reject(new Error('worlds')));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(PartySync.forApp(vault.app)?.isKeeping()).toBe(true);
    for (const cleanup of cleanups) cleanup();
  });
});
