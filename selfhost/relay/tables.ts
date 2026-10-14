import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import { sendJson } from './respond.ts';

// The relay's own work, still to be written. The plugin's side of every exchange is in
// src/app/online/gm/ (createTable.ts, TableConnection.ts, joinGate.ts) and the rules the
// relay enforces are in src/app/online/protocol/relay.ts. See selfhost/README.md.

/** Which listener a socket arrived on: the GM's loopback side or the tunnelled public side. */
export type Side = 'gm' | 'public';

/**
 * POST /api/tables on the GM side, with the GM's token (checked by the caller).
 * Answer 201 with `{ code, secret, maxPlayers }`: `code` matches `TABLE_CODE_PATTERN`,
 * `secret` matches `SECRET_PATTERN` and is at least 32 characters (`readCreated` in createdTable.ts).
 */
export function createTable(_request: IncomingMessage, response: ServerResponse): void {
  sendJson(response, 501, { error: 'Tables are not implemented on this relay yet.' });
}

/**
 * A socket opened on `/api/tables/<code>/socket`. The first frame is a `hello`: the GM's
 * (`role: 'gm'` with the table's secret) must arrive on the GM side, players' on the public side.
 */
export function joinTable(socket: WebSocket, code: string, side: Side): void {
  console.log(`socket for table ${code} on the ${side} side: relay not implemented, closing`);
  socket.close(1011, 'relay not implemented');
}
