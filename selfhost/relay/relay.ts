import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { MAX_GM_FRAME, MAX_PLAYER_FRAME, TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { createAccount } from './account.ts';
import { createDiagnostics } from './diagnostics.ts';
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

/** Sockets the public side holds at once, and from one visitor's address. */
export const MAX_PUBLIC_SOCKETS = 300;
export const MAX_SOCKETS_PER_SOURCE = 20;

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The GM side answers only requests addressed to this machine by name. A web page the GM opens could
 * make its own domain point at 127.0.0.1 (DNS rebinding); its requests then carry that domain as Host.
 */
function addressedToLoopback(request: IncomingMessage): boolean {
  const host = request.headers.host ?? '';
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? '';
  return LOOPBACK_NAMES.has(name.toLowerCase());
}

/** A socket a web page opened: browsers name the page's origin. Obsidian is no web page (its origin is not http or https). */
function fromWebPage(request: IncomingMessage): boolean {
  return /^https?:/i.test(request.headers.origin ?? '');
}

/** The visitor's address Cloudflare names on requests through the tunnel; `local` for anything else. */
function sourceOf(request: IncomingMessage): string {
  const named = request.headers['cf-connecting-ip'];
  return typeof named === 'string' && named !== '' ? named : 'local';
}

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
  /** Open public sockets by visitor address. */
  const publicSources = new Map<string, number>();

  const servers: Server[] = [];
  const gmServer = createServer((request, response) => handleGm(request, response));
  const publicServer = createServer((request, response) => handlePublic(request, response));
  servers.push(gmServer, publicServer);
  const gmOriginPort = await listen(gmServer, options.gmPort, options.host);
  const account = createAccount(options.dataDir, `http://127.0.0.1:${gmOriginPort}`, options.playerOrigin);
  const diagnostics = createDiagnostics(options.dataDir);

  function handleGm(request: IncomingMessage, response: ServerResponse): void {
    if (!addressedToLoopback(request)) return sendJson(response, 421, { error: 'wrong-host' });
    const pathname = pathnameOf(request);
    if (account.handle(request, response, pathname)) return;
    if (diagnostics.owns(pathname)) {
      // A web page may reach loopback by its address; only Obsidian, which is no web page, writes here.
      if (fromWebPage(request)) return sendJson(response, 403, { error: 'web-page' });
      return diagnostics.handle(request, response, pathname);
    }
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
    void servePlayerPage(response, pathname, request.headers.host);
  }

  function upgrade(side: Side, request: IncomingMessage, stream: Duplex, head: Buffer): void {
    const code = SOCKET_PATH.exec(pathnameOf(request))?.[1];
    if (code === undefined || !TABLE_CODE_PATTERN.test(code)) {
      stream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (side === 'gm' && (!addressedToLoopback(request) || fromWebPage(request))) {
      stream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const source = side === 'gm' ? 'local' : sourceOf(request);
    if (side === 'public') {
      const fromSource = publicSources.get(source) ?? 0;
      if (publicSockets.clients.size >= MAX_PUBLIC_SOCKETS || fromSource >= MAX_SOCKETS_PER_SOURCE) {
        stream.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
        return;
      }
    }
    const sockets = side === 'gm' ? gmSockets : publicSockets;
    sockets.handleUpgrade(request, stream, head, (socket) => {
      const link = new Link(socket, side === 'gm' ? MAX_GM_FRAME : MAX_PLAYER_FRAME, source);
      if (side === 'public') publicSources.set(source, (publicSources.get(source) ?? 0) + 1);
      idle.update(openSockets());
      socket.on('close', () => {
        if (side === 'public') {
          const left = (publicSources.get(source) ?? 1) - 1;
          if (left <= 0) publicSources.delete(source);
          else publicSources.set(source, left);
        }
        idle.update(openSockets());
      });
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
