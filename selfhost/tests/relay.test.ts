import { afterEach, describe, expect, it } from 'vitest';
import { readCreated } from '../../src/app/online/gm/createdTable.ts';
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
    const back = player(code, { name: 'Mira', key });
    await until(() => back.frame('waiting') !== undefined, 'kicked key is a newcomer again');
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

  it('answers a frame larger than a player may send with tooLarge', async () => {
    const { code } = await table();
    const mira = player(code, { name: 'Mira' });
    await until(() => mira.frame('welcome') !== undefined, 'welcome');
    mira.send({ t: 'move', data: 'x'.repeat(5_000) });
    await until(() => mira.closeCode !== null, 'too large');
    expect(mira.closeCode).toBe(CLOSE.tooLarge);
  });
});
