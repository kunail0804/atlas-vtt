import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { TABLE_CODE_PATTERN } from '../../src/app/online/protocol/relay.ts';
import { handleAccountRequest, isHost } from './account.ts';
import { GM_PORT, LOOPBACK, PUBLIC_PORT } from './config.ts';
import { sendJson, sendText } from './respond.ts';
import { servePlayerPage } from './staticFiles.ts';
import { createTable, joinTable, type Side } from './tables.ts';

// Compression is off: every frame would pay for deflate on both ends, and latency matters more
// than bytes here. `ws` already sets TCP_NODELAY on every socket, so small frames leave at once.
const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });

const SOCKET_PATH = /^\/api\/tables\/([^/]+)\/socket$/;

function pathnameOf(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://relay').pathname;
}

function handleGmRequest(request: IncomingMessage, response: ServerResponse): void {
  const pathname = pathnameOf(request);
  if (handleAccountRequest(request, response, pathname)) return;
  if (request.method === 'POST' && pathname === '/api/tables') {
    if (!isHost(request)) {
      sendJson(response, 401, { error: 'signed-out' });
      return;
    }
    createTable(request, response);
    return;
  }
  sendJson(response, 404, { error: 'not-found' });
}

function handlePublicRequest(request: IncomingMessage, response: ServerResponse): void {
  const pathname = pathnameOf(request);
  if (pathname === '/health') {
    sendText(response, 200, 'ok');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method-not-allowed' });
    return;
  }
  void servePlayerPage(response, pathname);
}

function handleUpgrade(side: Side, request: IncomingMessage, stream: Duplex, head: Buffer): void {
  const match = SOCKET_PATH.exec(pathnameOf(request));
  const code = match?.[1];
  if (code === undefined || !TABLE_CODE_PATTERN.test(code)) {
    stream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, stream, head, (socket) => joinTable(socket, code, side));
}

const gmServer = createServer(handleGmRequest);
gmServer.on('upgrade', (request: IncomingMessage, stream: Duplex, head: Buffer) => handleUpgrade('gm', request, stream, head));
gmServer.listen(GM_PORT, LOOPBACK, () => console.log(`GM side      http://${LOOPBACK}:${GM_PORT}  (loopback only)`));

const publicServer = createServer(handlePublicRequest);
publicServer.on('upgrade', (request: IncomingMessage, stream: Duplex, head: Buffer) => handleUpgrade('public', request, stream, head));
publicServer.listen(PUBLIC_PORT, LOOPBACK, () => console.log(`Public side  http://${LOOPBACK}:${PUBLIC_PORT}  (forwarded by the tunnel)`));
