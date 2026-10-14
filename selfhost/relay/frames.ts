import type { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../src/app/online/protocol/relay.ts';

/** Sends a relay frame (`RelayFrame` in relay.ts) to a socket that is still open. */
export function sendFrame(socket: WebSocket, frame: Readonly<Record<string, unknown>>): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...frame }));
}

/** Sends text already serialised once for several sockets. */
export function sendText(socket: WebSocket, text: string): void {
  if (socket.readyState === socket.OPEN) socket.send(text);
}

export function closeSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, reason);
}
