import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { MAX_GM_FRAME, MAX_PLAYER_FRAME, TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { createAccount } from './account.ts';
import { IdleStop } from './idle.ts';
import { Link } from './link.ts';
import { sendJson, sendText } from './respond.ts';
import { servePlayerPage } from './staticFiles.ts';
import { TableStore } from './tableStore.ts';
import { Tables, type Side } from './tables.ts';

export interface RelayOptions {
  /** Every listener binds here. In the container this is 0.0.0.0, and Docker publishes the GM side on the host's loopback only. */
  readonly host: string;
  readonly gmPort: number;
  readonly publicPort: number;
  /** Tables and the GM's token. */
  readonly dataDir: string;
  /** The campaign's public address, e.g. https://name2-vtt.kunlab.cc. */
  readonly playerOrigin: string;
  /** Stop after this long with no socket open; null never stops. */
  readonly idleStopMs: number | null;
  readonly onIdle: () => void;
}

export interface RunningRelay {
  readonly gmPort: number;
  readonly publicPort: number;
  close(): Promise<void>;
}

const SOCKET_PATH = /^\/api\/tables\/([^/]+)\/socket$/;

function pathnameOf(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://relay').pathname;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  const tables = new Tables(new TableStore(options.dataDir));
  // Compression is off: every frame would pay for deflate on both ends, and latency matters more
  // than bytes here. `ws` sets TCP_NODELAY on every socket, so small frames leave at once.
  // The frame limits leave room for the protocol's own (MAX_GM_FRAME, MAX_PLAYER_FRAME), which `Link`
  // enforces with the protocol's close code; these only bound what a socket can make the relay hold.
  const gmSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_GM_FRAME * 2 });
  const publicSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const idle = new IdleStop(options.idleStopMs, options.onIdle);
  const openSockets = (): number => gmSockets.clients.size + publicSockets.clients.size;

  const servers: Server[] = [];
  const gmServer = createServer((request, response) => handleGm(request, response));
  const publicServer = createServer((request, response) => handlePublic(request, response));
  servers.push(gmServer, publicServer);
  const gmOriginPort = await listen(gmServer, options.gmPort, options.host);
  const account = createAccount(options.dataDir, `http://127.0.0.1:${gmOriginPort}`, options.playerOrigin);

  function handleGm(request: IncomingMessage, response: ServerResponse): void {
    const pathname = pathnameOf(request);
    if (account.handle(request, response, pathname)) return;
    if (request.method === 'POST' && pathname === '/api/tables') {
      if (!account.isHost(request)) return sendJson(response, 401, { error: 'signed-out' });
      return sendJson(response, 201, { ...tables.create(), playerOrigin: options.playerOrigin });
    }
    sendJson(response, 404, { error: 'not-found' });
  }

  function handlePublic(request: IncomingMessage, response: ServerResponse): void {
    const pathname = pathnameOf(request);
    if (pathname === '/health') return sendText(response, 200, 'ok');
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method-not-allowed' });
    void servePlayerPage(response, pathname);
  }

  function upgrade(side: Side, request: IncomingMessage, stream: Duplex, head: Buffer): void {
    const code = SOCKET_PATH.exec(pathnameOf(request))?.[1];
    if (code === undefined || !TABLE_CODE_PATTERN.test(code)) {
      stream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const sockets = side === 'gm' ? gmSockets : publicSockets;
    sockets.handleUpgrade(request, stream, head, (socket) => {
      const link = new Link(socket, side === 'gm' ? MAX_GM_FRAME : MAX_PLAYER_FRAME);
      idle.update(openSockets());
      socket.on('close', () => idle.update(openSockets()));
      tables.join(link, code, side);
    });
  }

  gmServer.on('upgrade', (request: IncomingMessage, stream: Duplex, head: Buffer) => upgrade('gm', request, stream, head));
  publicServer.on('upgrade', (request: IncomingMessage, stream: Duplex, head: Buffer) => upgrade('public', request, stream, head));
  const publicPort = await listen(publicServer, options.publicPort, options.host);
  idle.update(openSockets());

  return {
    gmPort: gmOriginPort,
    publicPort,
    async close() {
      idle.stop();
      for (const socket of [...gmSockets.clients, ...publicSockets.clients]) socket.terminate();
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    },
  };
}
