import { afterEach, describe, expect, it } from 'vitest';
import { readCreated } from '../../src/app/online/gm/createdTable.ts';
import { BATCH_MS } from '../../src/app/online/gm/sendQueue.ts';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { PLAYER_ORIGIN, TestGm, TestPlayer, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

const SCENE = { t: 'scene', scene: null } as const;

describe('the relay with the plugin as GM', () => {
  let test: TestRelay;
  const gms: TestGm[] = [];
  const players: TestPlayer[] = [];

  afterEach(async () => {
    for (const gm of gms.splice(0)) gm.connection.stop();
    for (const player of players.splice(0)) player.socket.close();
    await stopTestRelay(test);
  });

  async function table(gate = { code: null as string | null, ask: false }): Promise<{ code: string; gm: TestGm }> {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    const gm = new TestGm(test.gmOrigin, created.code, created.secret);
    gm.gateFrame = gate;
    gms.push(gm);
    await until(() => gm.status === 'online', 'GM online');
    return { code: created.code, gm };
  }

  function player(code: string, hello: Record<string, unknown>): TestPlayer {
    const joining = new TestPlayer(test.publicUrl, code, hello);
    players.push(joining);
    return joining;
  }

  it('creates a table the plugin accepts, and names the campaign address', async () => {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    expect(created.code).toMatch(/^[a-z2-7]{26}$/);
    expect(created.secret.length).toBeGreaterThanOrEqual(32);
    expect(created.playerOrigin).toBe(PLAYER_ORIGIN);
    // The plugin's own reader takes the answer as a table, with the campaign's address.
    expect(readCreated(201, created)).toEqual(created);
  });

  it('answers a time exchange with its own clock, which it offers in the welcome', async () => {
    const { code } = await table();
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'player welcome');
    expect(mira.frame('welcome')).toMatchObject({ clock: true });

    const before = Date.now();
    mira.socket.send(JSON.stringify({ v: 1, t: 'time', t1: 1234.5 }));
    await until(() => mira.frame('time') !== undefined, 'time answer');
    const answer = mira.frame('time');
    expect(answer?.t1).toBe(1234.5);
    expect(answer?.t2).toBeGreaterThanOrEqual(before);
    expect(answer?.t2).toBeLessThanOrEqual(Date.now());
  });

  it('seats a player without a gate and carries game messages both ways', async () => {
    const { code, gm } = await table();
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'player welcome');
    expect(mira.frame('welcome')).toMatchObject({ role: 'player', gmOnline: true });
    await until(() => gm.joined.length === 1, 'GM hears the player');
    const id = gm.joined[0]?.id ?? '';

    mira.send({ t: 'move', token: 'x' });
    await until(() => gm.messages.length === 1, 'GM gets the message');
    expect(gm.messages[0]).toEqual({ from: id, body: { t: 'move', token: 'x' } });

    gm.connection.send(SCENE);
    await until(() => mira.frame('game') !== undefined, 'player gets the scene');
    expect(mira.frame('game')).toEqual({ v: 1, t: 'game', body: SCENE });
  });

  it('refuses a wrong join code, and holds a right one until the GM admits', async () => {
    const { code, gm } = await table({ code: '483912', ask: true });
    const wrong = player(code, { name: 'Intruder', code: '000000' });
    await until(() => wrong.closeCode !== null, 'wrong code closed');
    expect(wrong.closeCode).toBe(CLOSE.wrongCode);

    const mira = player(code, { name: 'Mira', code: '483912' });
    await until(() => gm.knocks.length === 1, 'GM sees the knock');
    expect(mira.frame('waiting')).toBeDefined();
    expect(mira.frame('welcome')).toBeUndefined();

    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => mira.frame('welcome') !== undefined, 'admitted player welcomed');
    expect(mira.frame('welcome')?.id).toBe(gm.knocks[0]?.id);
    expect(gm.gone).toEqual([{ id: gm.knocks[0]?.id, full: false }]);
  });

  it('admits a newcomer who came back with the token of their wait', async () => {
    const { code, gm } = await table({ code: null, ask: true });
    const first = player(code, { name: 'Mira', waits: true });
    await until(() => typeof first.frame('waiting')?.wait === 'string', 'wait token');
    const wait = String(first.frame('waiting')?.wait);
    await until(() => gm.knocks.length === 1, 'GM sees the knock');

    // The network drops; the page comes back with its token and takes the same wait up again.
    const back = player(code, { name: 'Mira', waits: true, wait });
    await until(() => back.frame('waiting') !== undefined, 'wait taken up');
    await until(() => first.closeCode !== null, 'old socket replaced');

    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => back.frame('welcome') !== undefined, 'admitted after coming back');
    expect(back.frame('welcome')?.id).toBe(gm.knocks[0]?.id);
  });

  it('turns a declined newcomer away', async () => {
    const { code, gm } = await table({ code: null, ask: true });
    const mira = player(code, { name: 'Mira' });
    await until(() => gm.knocks.length === 1, 'knock');
    gm.connection.answer(gm.knocks[0]?.id ?? '', false);
    await until(() => mira.closeCode !== null, 'declined');
    expect(mira.closeCode).toBe(CLOSE.declined);
  });

  it('pauses joins after too many wrong codes, and a new code ends the pause', async () => {
    const { code, gm } = await table({ code: '483912', ask: false });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = player(code, { name: 'Guess', code: String(100000 + attempt) });
      await until(() => wrong.closeCode !== null, 'wrong code');
    }
    await until(() => gm.pauses.length === 1, 'GM told of the pause');
    const right = player(code, { name: 'Mira', code: '483912' });
    await until(() => right.closeCode !== null, 'paused');
    expect(right.closeCode).toBe(CLOSE.paused);

    gm.gateFrame = { code: '271828', ask: false };
    gm.connection.sendGate(gm.gateFrame);
    const after = player(code, { name: 'Mira', code: '271828' });
    await until(() => after.frame('welcome') !== undefined, 'new code admits');
  });

  it('kicks a player, who cannot come back with their key', async () => {
    const { code, gm } = await table();
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'welcome');
    const key = mira.frame('welcome')?.key;
    gm.connection.kick(String(mira.frame('welcome')?.id));
    await until(() => mira.closeCode !== null, 'kicked');
    expect(mira.closeCode).toBe(CLOSE.kicked);
    gm.gateFrame = { code: null, ask: true };
    gm.connection.sendGate(gm.gateFrame);
    // A GM's queue sends one frame at most every BATCH_MS to a relay that batches: the gate goes after the kick.
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    const back = player(code, { name: 'Mira', key });
    await until(() => back.frame('waiting') !== undefined, 'kicked key is a newcomer again');
  });

  it('seats a player of the campaign by their own code past the gate, on any device, and leaves a newcomer who takes their name to the GM', async () => {
    const { code, gm } = await table({ code: '483912', ask: true });
    const ana = player(code, { name: 'Ana', code: '483912' });
    await until(() => gm.knocks.length === 1, 'Ana knocks');
    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => ana.frame('welcome') !== undefined, 'Ana seated');
    const id = String(ana.frame('welcome')?.id);
    gm.connection.setPlayers([{ id, name: 'Ana', code: '271828' }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    // Another device, without a key: her own code seats her as herself, without the GM's answer.
    const again = player(code, { name: 'Ana', code: '271828' });
    await until(() => again.frame('welcome') !== undefined, 'Ana seated by her own code');
    expect(again.frame('welcome')?.id).toBe(id);
    expect(gm.knocks).toHaveLength(1);
    const impostor = player(code, { name: 'ana', code: '483912' });
    await until(() => gm.knocks.length === 2, 'the GM is asked for her seat');
    expect(gm.knocks[1]).toMatchObject({ name: 'ana', reclaim: true });
    expect(impostor.frame('welcome')).toBeUndefined();
    gm.connection.answer(gm.knocks[1]?.id ?? '', false);
    await until(() => impostor.closeCode !== null, 'declined');
    expect(impostor.closeCode).toBe(CLOSE.declined);
    expect(again.closeCode).toBeNull();
  });

  /** Mira at a table that asks for no code and lets newcomers in without the GM, then made a player of the campaign. */
  async function campaignTable(): Promise<{ code: string; gm: TestGm; mira: TestPlayer; id: string; key: string }> {
    const { code, gm } = await table({ code: null, ask: false });
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'Mira seated');
    const { id, key } = mira.frame('welcome') as { id: string; key: string };
    gm.connection.setPlayers([{ id, name: 'Mira', code: '271828' }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    return { code, gm, mira, id, key };
  }

  it('gives a player of the campaign who lost their key their seat back once the GM admits them, and the old key no longer seats anyone', async () => {
    const { code, gm, mira, id, key } = await campaignTable();
    // She clears her browser: the page comes back with her name only, no key and no own code.
    mira.socket.close();
    await until(() => mira.closeCode !== null, 'old page gone');
    const back = player(code, { name: 'Mira' });
    await until(() => back.frame('waiting') !== undefined || back.closeCode !== null, 'Mira waits or is refused');
    expect(back.closeCode).toBeNull();
    // The GM is asked even though the table lets newcomers in without asking, and is told it is a seat taken back.
    await until(() => gm.knocks.length === 1, 'GM asked');
    expect(gm.knocks[0]).toMatchObject({ name: 'Mira', reclaim: true });

    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => back.frame('welcome') !== undefined, 'Mira seated again');
    const welcome = back.frame('welcome') as { id: string; key: string };
    expect(welcome.id).toBe(id);
    expect(welcome.key).not.toBe(key);

    // The key of the browser she cleared seats nobody now: it only asks the GM again.
    const stale = player(code, { name: 'Mira', key });
    await until(() => stale.frame('waiting') !== undefined || stale.frame('welcome') !== undefined || stale.closeCode !== null, 'old key answered');
    expect(stale.frame('welcome')).toBeUndefined();
    expect(stale.frame('waiting')).toBeDefined();
    expect(back.closeCode).toBeNull();
    // The new key keeps the seat from one page to the next.
    back.socket.close();
    const reload = player(code, { name: 'Mira', key: welcome.key });
    await until(() => reload.frame('welcome') !== undefined, 'new key seats her');
    expect(reload.frame('welcome')?.id).toBe(id);
  });

  it('seats a key given under an id the GM merged into another player under that player\'s id', async () => {
    const { code, gm, mira, id, key } = await campaignTable();
    mira.socket.close();
    await until(() => mira.closeCode !== null, 'old page gone');
    // The GM's players were merged: Mira is now the player who had another id, and names hers as one she had.
    const merged = 'm'.repeat(20);
    gm.connection.setPlayers([{ id: merged, name: 'Mira', code: '271828', was: [id] }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    const back = player(code, { name: 'Mira', key });
    await until(() => back.frame('welcome') !== undefined, 'Mira seated by her key');
    expect(back.frame('welcome')).toMatchObject({ id: merged, key });
    // Her key keeps the merged seat from one page to the next.
    back.socket.close();
    await until(() => back.closeCode !== null, 'page gone');
    const reload = player(code, { name: 'Mira', key });
    await until(() => reload.frame('welcome') !== undefined, 'seated again');
    expect(reload.frame('welcome')?.id).toBe(merged);
  });

  it('leaves a seat where the campaign still names its id, whoever else says they had it', async () => {
    const { code, gm, mira, id, key } = await campaignTable();
    mira.socket.close();
    await until(() => mira.closeCode !== null, 'old page gone');
    gm.connection.setPlayers([{ id, name: 'Mira', code: '271828' }, { id: 'o'.repeat(20), name: 'Oren', code: '314159', was: [id] }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    const back = player(code, { name: 'Mira', key });
    await until(() => back.frame('welcome') !== undefined, 'Mira seated by her key');
    expect(back.frame('welcome')?.id).toBe(id);
  });

  it('never seats two pages on one seat: a key that was not moved loses the seat to the one the GM admitted, and cannot take it back', async () => {
    const { code, gm, mira, id, key } = await campaignTable();
    // Someone else holds her old key and sits in her seat when she asks for it from a new browser.
    mira.socket.close();
    await until(() => mira.closeCode !== null, 'old page gone');
    const thief = player(code, { name: 'Mira', key });
    await until(() => thief.frame('welcome') !== undefined, 'old key seated before the transfer');
    const back = player(code, { name: 'Mira' });
    const other = player(code, { name: 'MIRA' });
    await until(() => gm.knocks.length === 2, 'GM asked twice');
    expect(gm.knocks.every((knock) => knock.reclaim === true)).toBe(true);

    const leftBefore = gm.left.length;
    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => back.frame('welcome') !== undefined, 'admitted page seated');
    expect(back.frame('welcome')?.id).toBe(id);
    await until(() => thief.closeCode !== null, 'old key put off the seat');
    expect(thief.closeCode).toBe(CLOSE.replaced);
    // The page put off the seat does not take the player who now sits in it off the GM's table.
    back.send({ t: 'ping-gm' });
    await until(() => gm.messages.some((message) => message.from === id), 'the seated page reaches the GM');
    expect(gm.left.slice(leftBefore)).toEqual([]);
    expect(gm.joined.at(-1)).toEqual({ id, name: 'Mira' });
    // The second page that asked is still waiting: it holds no seat.
    expect(other.frame('welcome')).toBeUndefined();
    expect(other.closeCode).toBeNull();

    const again = player(code, { name: 'Mira', key });
    await until(() => again.frame('waiting') !== undefined || again.frame('welcome') !== undefined || again.closeCode !== null, 'old key answered');
    expect(again.frame('welcome')).toBeUndefined();
    gm.connection.answer(gm.knocks[1]?.id ?? '', false);
    await until(() => other.closeCode !== null, 'second page declined');
    expect(other.closeCode).toBe(CLOSE.declined);
    expect(back.closeCode).toBeNull();
  });

  it('keeps the seat on its key when the GM declines, and asks a page that takes a seat back for the join code first', async () => {
    const { code, gm, mira, key } = await campaignTable();
    const asking = player(code, { name: 'Mira' });
    await until(() => gm.knocks.length === 1, 'GM asked');
    gm.connection.answer(gm.knocks[0]?.id ?? '', false);
    await until(() => asking.closeCode !== null, 'declined');
    expect(asking.closeCode).toBe(CLOSE.declined);
    expect(mira.closeCode).toBeNull();

    gm.gateFrame = { code: '483912', ask: false };
    gm.connection.sendGate(gm.gateFrame);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));
    const noCode = player(code, { name: 'Mira' });
    await until(() => noCode.closeCode !== null, 'no join code');
    expect(noCode.closeCode).toBe(CLOSE.wrongCode);
    expect(gm.knocks).toHaveLength(1);

    mira.socket.close();
    await until(() => mira.closeCode !== null, 'old page gone');
    const back = player(code, { name: 'Mira', key });
    await until(() => back.frame('welcome') !== undefined, 'her key still seats her');
  });

  it('takes a GM hello only on the GM side and a player hello only on the public side', async () => {
    const { code } = await table();
    const fake = new WebSocket(`${test.publicUrl}/api/tables/${code}/socket`);
    let closed: number | null = null;
    fake.addEventListener('open', () => fake.send(JSON.stringify({ v: 1, t: 'hello', role: 'gm', secret: 'a'.repeat(43) })));
    fake.addEventListener('close', (event) => (closed = event.code));
    await until(() => closed !== null, 'GM hello refused on the public side');
    expect(closed).toBe(CLOSE.protocol);

    const wrongSide = new TestPlayer(test.gmOrigin.replace('http', 'ws'), code, { name: 'Mira' });
    players.push(wrongSide);
    await until(() => wrongSide.closeCode !== null, 'player hello refused on the GM side');
    expect(wrongSide.closeCode).toBe(CLOSE.protocol);
  });

  it('ends an older table when a new one is created', async () => {
    const { gm } = await table();
    await createTable(test.gmOrigin);
    await until(() => gm.status === 'refused', 'old table refused');
    expect(gm.connection.closeCode).toBe(CLOSE.superseded);
  });

  it("opens the table on the campaign's lasting link, again after a restart of the table", async () => {
    const { code, gm } = await table();
    const again = await createTable(test.gmOrigin, code);
    expect(again.code).toBe(code);
    await until(() => gm.status === 'refused', 'old table refused');
    // The table before, ending on the same code, leaves the new one in place.
    const next = new TestGm(test.gmOrigin, again.code, again.secret);
    gms.push(next);
    await until(() => next.status === 'online', 'GM online on the same link');
  });

  it('refuses a table on a link that is no table code', async () => {
    test = await startTestRelay();
    await expect(createTable(test.gmOrigin, 'not-a-code')).rejects.toThrow(/400/);
  });

  it('answers a frame larger than a player may send with tooLarge', async () => {
    const { code } = await table();
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'welcome');
    mira.send({ t: 'move', data: 'x'.repeat(5_000) });
    await until(() => mira.closeCode !== null, 'too large');
    expect(mira.closeCode).toBe(CLOSE.tooLarge);
  });
});
