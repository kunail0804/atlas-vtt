import { afterEach, describe, expect, it } from 'vitest';
import { BATCH_MS } from '../../src/app/online/gm/sendQueue.ts';
import { CLOSE } from '../../src/app/online/protocol/relay.ts';
import { TestGm, TestPlayer, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

describe('the relay across restarts and idle time', () => {
  const relays: TestRelay[] = [];
  const closers: (() => void)[] = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) close();
    for (const relay of relays.splice(0)) await stopTestRelay(relay);
  });

  it('keeps tables and player keys through a restart: same table, same seat', async () => {
    const first = await startTestRelay();
    const created = await createTable(first.gmOrigin);
    const gm = new TestGm(first.gmOrigin, created.code, created.secret);
    closers.push(() => gm.connection.stop());
    await until(() => gm.status === 'online', 'GM online');
    const mira = new TestPlayer(first.publicUrl, created.code, { name: 'Mira' });
    closers.push(() => mira.socket.close());
    await until(() => mira.frame('welcome') !== undefined, 'welcome');
    const { id, key } = mira.frame('welcome') as { id: string; key: string };

    await stopTestRelay(first, true);
    await until(() => gm.status === 'connecting', 'GM notices the stop');
    const second = await startTestRelay({ dataDir: first.dataDir, gmPort: first.relay.gmPort, publicPort: first.relay.publicPort });
    relays.push(second);

    // The plugin reconnects on its own, with the secret it kept.
    await until(() => gm.status === 'online', 'GM back online', 10_000);
    gm.gateFrame = { code: null, ask: true };
    gm.connection.sendGate(gm.gateFrame);
    const back = new TestPlayer(second.publicUrl, created.code, { name: 'Mira', key });
    closers.push(() => back.socket.close());
    await until(() => back.frame('welcome') !== undefined, 'player seated again without waiting');
    expect(back.frame('welcome')?.id).toBe(id);
  });

  it("seats a player of the campaign by their kept key at the table started again on the campaign's link, and still leaves a newcomer who takes their name to the GM", async () => {
    const first = await startTestRelay();
    const created = await createTable(first.gmOrigin);
    const link = created.code;
    const gm = new TestGm(first.gmOrigin, created.code, created.secret);
    closers.push(() => gm.connection.stop());
    await until(() => gm.status === 'online', 'GM online');
    const mira = new TestPlayer(first.publicUrl, link, { name: 'Mira' });
    closers.push(() => mira.socket.close());
    await until(() => mira.frame('welcome') !== undefined, 'welcome');
    const { id, key } = mira.frame('welcome') as { id: string; key: string };
    gm.connection.stop();

    // The campaign stops and starts again: a new relay on the same data, and a new table on the same link.
    await stopTestRelay(first, true);
    const second = await startTestRelay({ dataDir: first.dataDir });
    relays.push(second);
    const again = await createTable(second.gmOrigin, link);
    const next = new TestGm(second.gmOrigin, again.code, again.secret);
    next.gateFrame = { code: null, ask: true };
    closers.push(() => next.connection.stop());
    await until(() => next.status === 'online', 'GM online on the table started again');
    next.connection.setPlayers([{ id, name: 'Mira', code: '271828' }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));

    const back = new TestPlayer(second.publicUrl, link, { name: 'Mira', key });
    closers.push(() => back.socket.close());
    await until(() => back.frame('welcome') !== undefined || back.closeCode !== null, 'Mira seated or refused');
    expect(back.closeCode).toBeNull();
    expect(back.frame('welcome')?.id).toBe(id);
    const impostor = new TestPlayer(second.publicUrl, link, { name: 'mira' });
    closers.push(() => impostor.socket.close());
    await until(() => next.knocks.length === 1, 'the GM is asked for her seat');
    expect(next.knocks[0]).toMatchObject({ name: 'mira', reclaim: true });
    next.connection.answer(next.knocks[0]?.id ?? '', false);
    await until(() => impostor.closeCode !== null, 'declined');
    expect(impostor.closeCode).toBe(CLOSE.declined);
    expect(back.closeCode).toBeNull();
  });

  it('stops after the idle time with nobody connected, and not while someone is', async () => {
    let idle = 0;
    const test = await startTestRelay({ idleStopMs: 300, onIdle: () => (idle += 1) });
    relays.push(test);
    const created = await createTable(test.gmOrigin);
    const gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(idle).toBe(0);

    gm.connection.stop();
    await until(() => idle === 1, 'idle stop after the GM left', 3_000);
  });
});
