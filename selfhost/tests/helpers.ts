import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TableConnection, type GateEvents, type TableEvents, type TableStatus } from '../../src/app/online/gm/TableConnection.ts';
import type { Timers } from '../../src/app/online/gm/companionTimers.ts';
import type { GateFrame } from '../../src/app/online/gm/joinGate.ts';
import type { PlayerInfo } from '../../src/app/online/protocol/index.ts';
import { startRelay, type RunningRelay } from '../relay/relay.ts';

export const PLAYER_ORIGIN = 'https://test-vtt.kunlab.cc';

export interface TestRelay {
  relay: RunningRelay;
  dataDir: string;
  gmOrigin: string;
  publicUrl: string;
}

export async function startTestRelay(options: { dataDir?: string; gmPort?: number; publicPort?: number; idleStopMs?: number | null; onIdle?: () => void } = {}): Promise<TestRelay> {
  const dataDir = options.dataDir ?? mkdtempSync(path.join(tmpdir(), 'atlas-relay-test-'));
  const relay = await startRelay({
    host: '127.0.0.1',
    gmPort: options.gmPort ?? 0,
    publicPort: options.publicPort ?? 0,
    dataDir,
    playerOrigin: PLAYER_ORIGIN,
    idleStopMs: options.idleStopMs ?? null,
    onIdle: options.onIdle ?? (() => undefined),
  });
  return { relay, dataDir, gmOrigin: `http://127.0.0.1:${relay.gmPort}`, publicUrl: `ws://127.0.0.1:${relay.publicPort}` };
}

export async function stopTestRelay(test: TestRelay, keepData = false): Promise<void> {
  await test.relay.close();
  if (!keepData) rmSync(test.dataDir, { recursive: true, force: true });
}

/** Signs in like the plugin does (device flow) and creates a table. */
export async function createTable(gmOrigin: string): Promise<{ code: string; secret: string; maxPlayers: number; playerOrigin: string }> {
  const tokenResponse = await fetch(`${gmOrigin}/auth/device/token`, { method: 'POST' });
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
  const response = await fetch(`${gmOrigin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  if (response.status !== 201) throw new Error(`table not created: ${response.status}`);
  return (await response.json()) as { code: string; secret: string; maxPlayers: number; playerOrigin: string };
}

export const nodeTimers: Timers = {
  now: () => Date.now(),
  setTimer: (run, ms) => Number(setTimeout(run, ms)),
  clearTimer: (timer) => clearTimeout(timer),
};

/** The plugin's GM connection with every event recorded. */
export class TestGm {
  readonly connection: TableConnection;
  readonly statuses: TableStatus[] = [];
  readonly joined: PlayerInfo[] = [];
  readonly left: string[] = [];
  readonly messages: { from: string; body: unknown }[] = [];
  readonly knocks: PlayerInfo[] = [];
  readonly gone: { id: string; full: boolean }[] = [];
  readonly pauses: number[] = [];
  gateFrame: GateFrame = { code: null, ask: false };

  constructor(gmOrigin: string, code: string, secret: string) {
    const events: TableEvents = {
      status: (status) => this.statuses.push(status),
      welcome: () => undefined,
      joined: (player) => this.joined.push(player),
      left: (id) => this.left.push(id),
      message: (from, body) => this.messages.push({ from, body }),
      access: () => undefined,
    };
    const gate: GateEvents = {
      frame: () => this.gateFrame,
      welcomed: () => undefined,
      knocked: (player) => this.knocks.push(player),
      gone: (id, full) => this.gone.push({ id, full }),
      paused: (until) => this.pauses.push(until),
    };
    this.connection = new TableConnection(gmOrigin, code, secret, events, gate, nodeTimers);
    this.connection.start();
  }

  get status(): TableStatus | undefined {
    return this.statuses.at(-1);
  }
}

/** A player's page reduced to its socket: every frame it receives, and how it closed. */
export class TestPlayer {
  readonly socket: WebSocket;
  readonly frames: Record<string, unknown>[] = [];
  closeCode: number | null = null;

  constructor(publicUrl: string, code: string, hello: Record<string, unknown>) {
    this.socket = new WebSocket(`${publicUrl}/api/tables/${code}/socket`);
    this.socket.addEventListener('open', () => this.socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'player', ...hello })));
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string' && event.data !== 'pong') this.frames.push(JSON.parse(event.data) as Record<string, unknown>);
    });
    this.socket.addEventListener('close', (event) => (this.closeCode = event.code));
  }

  frame(t: string): Record<string, unknown> | undefined {
    return this.frames.find((frame) => frame.t === t);
  }

  send(body: unknown): void {
    this.socket.send(JSON.stringify({ v: 1, t: 'send', body }));
  }
}

/** Waits until `check` holds, polling: the relay and the clients talk over real sockets. */
export async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
