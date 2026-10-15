import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { CLOSE, FINAL_CLOSE_CODES, KEEPALIVE_MS, KEEPALIVE_PING, PROTOCOL_VERSION, parseRelayFrame } from '../../../src/app/online/protocol/relay.ts';

/** What the player typed on the join screen. */
export interface JoinRequest {
  readonly name: string;
  /** The six-digit join code, or null when the GM asks for none. */
  readonly code: string | null;
}

export type ConnectionEvent =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'welcome'; readonly id: string; readonly gmOnline: boolean }
  | { readonly kind: 'gm'; readonly online: boolean }
  | { readonly kind: 'game'; readonly body: unknown }
  /** `final`: the relay closed for good (kicked, wrong code, table ended…); otherwise the page reconnects by itself. */
  | { readonly kind: 'closed'; readonly code: number; readonly final: boolean };

const MAX_BACKOFF_MS = 15_000;
/** A socket that hears nothing for this long after a keep-alive is dead, even without a close. */
const SILENCE_LIMIT_MS = KEEPALIVE_MS + 20_000;

const keyName = (table: string): string => `atlas-vtt:key:${table}`;

/**
 * The player's socket to the table on this same origin. The key the relay gives on the first
 * welcome is kept in the browser, so a reload or a new tab takes the same seat back without the
 * join code or the GM's answer.
 */
export class PlayerConnection {
  private readonly table: string;
  private readonly request: JoinRequest;
  private readonly listener: (event: ConnectionEvent) => void;
  private socket: WebSocket | null = null;
  private wait: string | null = null;
  private attempts = 0;
  private stopped = false;
  private keepAlive: number | undefined;
  private silence: number | undefined;
  private retry: number | undefined;

  constructor(table: string, request: JoinRequest, listener: (event: ConnectionEvent) => void) {
    this.table = table;
    this.request = request;
    this.listener = listener;
  }

  start(): void {
    if (this.stopped) return;
    this.listener({ kind: 'connecting' });
    const url = `${window.location.origin.replace(/^http/, 'ws')}/api/tables/${this.table}/socket`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'hello', role: 'player', ...this.hello() }));
      this.keepAlive = window.setInterval(() => socket.send(KEEPALIVE_PING), KEEPALIVE_MS);
      this.heard();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      this.heard();
      this.receive(event.data);
    });
    socket.addEventListener('close', (event) => this.closed(socket, event.code));
  }

  /** Sends a game message to the GM; dropped while the socket is not open. */
  send(body: PlayerMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'send', body }));
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, 'left');
  }

  private hello(): Record<string, unknown> {
    const key = window.localStorage.getItem(keyName(this.table));
    return {
      name: this.request.name,
      ...(key === null ? {} : { key }),
      ...(this.request.code === null ? {} : { code: this.request.code }),
      waits: true,
      ...(this.wait === null ? {} : { wait: this.wait }),
    };
  }

  private receive(text: string): void {
    if (text === 'pong') return;
    const frame = parseRelayFrame(text);
    if (frame === null) return;
    switch (frame.t) {
      case 'welcome':
        if (frame.role !== 'player') return;
        this.attempts = 0;
        this.wait = null;
        window.localStorage.setItem(keyName(this.table), frame.key);
        this.listener({ kind: 'welcome', id: frame.id, gmOnline: frame.gmOnline });
        return;
      case 'waiting':
        if (frame.wait !== undefined) this.wait = frame.wait;
        this.listener({ kind: 'waiting' });
        return;
      case 'gm':
        this.listener({ kind: 'gm', online: frame.online });
        return;
      case 'game':
        this.listener({ kind: 'game', body: frame.body });
        return;
      default:
        return;
    }
  }

  private heard(): void {
    window.clearTimeout(this.silence);
    this.silence = window.setTimeout(() => this.socket?.close(), SILENCE_LIMIT_MS);
  }

  private closed(socket: WebSocket, code: number): void {
    if (socket !== this.socket) return;
    this.clearTimers();
    this.socket = null;
    const final = FINAL_CLOSE_CODES.includes(code);
    // A seat that is gone for good must not be tried again with its key.
    if (code === CLOSE.kicked || code === CLOSE.ended) window.localStorage.removeItem(keyName(this.table));
    this.listener({ kind: 'closed', code, final });
    if (final || this.stopped) return;
    this.attempts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.retry = window.setTimeout(() => this.start(), delay);
  }

  private clearTimers(): void {
    window.clearInterval(this.keepAlive);
    window.clearTimeout(this.silence);
    window.clearTimeout(this.retry);
  }
}
