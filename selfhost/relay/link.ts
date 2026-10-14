import type { RawData, WebSocket } from 'ws';
import { CLOSE, KEEPALIVE_PING, KEEPALIVE_PONG } from '../../src/app/online/protocol/relay.ts';
import { closeSocket, sendText } from './frames.ts';

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(new Uint8Array(data));
}

/**
 * One socket on the relay. It answers keep-alives at every stage, refuses binary and oversized
 * frames, and hands every other text frame to whoever owns the socket now: the hello reader, the
 * waiting room, then the table seat.
 */
export class Link {
  readonly socket: WebSocket;
  private readonly maxFrameBytes: number;
  private handler: (text: string) => void = () => undefined;

  constructor(socket: WebSocket, maxFrameBytes: number) {
    this.socket = socket;
    this.maxFrameBytes = maxFrameBytes;
    socket.on('message', (data: RawData, isBinary: boolean) => this.receive(data, isBinary));
    // A socket error is followed by its close; without a listener it would crash the process.
    socket.on('error', () => undefined);
  }

  onText(handler: (text: string) => void): void {
    this.handler = handler;
  }

  private receive(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      closeSocket(this.socket, CLOSE.protocol, 'binary frame');
      return;
    }
    const bytes = toBuffer(data);
    if (bytes.length > this.maxFrameBytes) {
      closeSocket(this.socket, CLOSE.tooLarge, 'frame too large');
      return;
    }
    const text = bytes.toString('utf8');
    if (text === KEEPALIVE_PING) {
      sendText(this.socket, KEEPALIVE_PONG);
      return;
    }
    this.handler(text);
  }
}
