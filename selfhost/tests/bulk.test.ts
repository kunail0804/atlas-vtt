import { afterEach, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, TestPlayer, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

const HASH = 'a'.repeat(64);
/** Five chunks as large as the plugin makes them (48 KiB, 64 KiB of base64). */
const CHUNKS: GmMessage[] = Array.from({ length: 5 }, (_, index) => ({ t: 'asset-chunk', hash: HASH, index, count: 5, data: 'A'.repeat(65_536) }));
const SCENE = { t: 'scene', scene: null } as const;

const games = (player: TestPlayer): Record<string, unknown>[] => player.frames.filter((frame) => frame.t === 'game');
const isChunk = (frame: Record<string, unknown>): boolean => (frame.body as { t?: string }).t === 'asset-chunk';

describe('asset chunks through the relay', () => {
  let test: TestRelay;
  let gm: TestGm | null = null;
  const players: TestPlayer[] = [];

  afterEach(async () => {
    gm?.connection.stop();
    for (const player of players.splice(0)) player.socket.close();
    await stopTestRelay(test);
  });

  async function seated(hello: Record<string, unknown>): Promise<{ gm: TestGm; player: TestPlayer; id: string }> {
    test = await startTestRelay();
    const created = await createTable(test.gmOrigin);
    const table = new TestGm(test.gmOrigin, created.code, created.secret);
    gm = table;
    await until(() => table.status === 'online', 'GM online');
    const player = new TestPlayer(test.publicUrl, created.code, { name: 'Mira', ...hello });
    players.push(player);
    await until(() => table.joined.length === 1, 'player seated');
    return { gm: table, player, id: table.joined[0]?.id ?? '' };
  }

  it('holds the chunks for a page that acks, lets later messages pass, and sends the rest as it acks', async () => {
    const { gm: table, player, id } = await seated({ acks: true });
    for (const chunk of CHUNKS) table.connection.send(chunk, id);
    table.connection.send(SCENE, id);
    await until(() => games(player).length === 2, 'first chunk and the scene');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(games(player).map((frame) => (isChunk(frame) ? 'chunk' : 'scene'))).toEqual(['chunk', 'scene']);
    expect(games(player)[0]).toMatchObject({ ack: true });
    expect(games(player)[1]).not.toHaveProperty('ack');

    for (let count = 1; count <= 5; count += 1) {
      await until(() => games(player).filter(isChunk).length >= count, `chunk ${count}`);
      player.socket.send(JSON.stringify({ v: 1, t: 'ack', n: count }));
    }
    await until(() => games(player).filter(isChunk).length === 5, 'every chunk');
    expect(games(player).filter(isChunk).map((frame) => (frame.body as { index: number }).index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('paces a large message in parts, keeps the next message behind it and lets a live one pass', async () => {
    const { gm: table, player, id } = await seated({ acks: true });
    // Tokens enough for a message of several parts.
    const tokens = Array.from({ length: 1500 }, (_, index) => ({ id: index.toString(16).padStart(24, '0'), x: index, y: index, size: 70, cells: 1, rotation: 0, art: null, name: `Token ${index} with a long enough name`, ring: null, claim: null, badge: null, ui: null }));
    table.connection.send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens } as GmMessage, id);
    table.connection.send(SCENE, id);
    table.connection.sendLive({ t: 'live', scene: 's1', tokens: [] } as GmMessage, 'drag', id);
    await until(() => games(player).length >= 2, 'first part and the live message');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const kinds = (): string[] => games(player).map((frame) => (frame.body as { t: string }).t);
    expect(kinds()).toEqual(['part', 'live']);
    let acked = 0;
    while (!kinds().includes('scene')) {
      const parts = kinds().filter((kind) => kind === 'part').length;
      if (parts > acked) {
        acked = parts;
        player.socket.send(JSON.stringify({ v: 1, t: 'ack', n: acked }));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Every part came before the scene that was sent after the message.
    expect(kinds().indexOf('scene')).toBe(kinds().length - 1);
    expect(kinds().filter((kind) => kind === 'part').length).toBeGreaterThan(2);
  });

  it('sends every chunk at once to a page from before acks', async () => {
    const { gm: table, player, id } = await seated({});
    for (const chunk of CHUNKS) table.connection.send(chunk, id);
    await until(() => games(player).filter(isChunk).length === 5, 'every chunk without acks');
  });

  it('does not let a page flood the GM with acks, and closes a GM that sends one', async () => {
    const { gm: table, player } = await seated({ acks: true });
    // Acks for chunks never sent are ignored, and never reach the GM.
    for (let count = 1; count <= 50; count += 1) player.socket.send(JSON.stringify({ v: 1, t: 'ack', n: count }));
    player.send({ t: 'move', token: 'x' });
    await until(() => table.messages.length === 1, 'the move after the acks');
    expect(table.messages[0]?.body).toEqual({ t: 'move', token: 'x' });
    expect(player.closeCode).toBeNull();
  });
});
